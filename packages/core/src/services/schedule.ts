import {
  memberAvailabilityUpdateSchema,
  scheduleQuerySchema,
  timeOffCreateSchema,
  type Role,
} from "@fieldops/shared";
import {
  effectiveHours,
  localDateOf,
  shiftDate,
  zonedInstant,
  type WorkingHoursEntry,
} from "../domain/availability";
import { NotFoundError, ValidationError } from "../domain/errors";
import { assertCan } from "../domain/permissions";
import type { TimeOffRecord } from "./dispatch-types";
import type { JobView, MemberRecord, ServiceContext } from "./types";
import { parseInput } from "./validate";

// The dispatch board (SCH-01, SCH-02), technician availability (SCH-04) and the agenda behind
// GET /schedule and GET /me/agenda.

export interface BoardLane {
  member: Pick<MemberRecord, "id" | "name" | "role" | "skills">;
  /** The hours that apply: the member's own, or the business hours. */
  workingHours: WorkingHoursEntry[];
  /** True when the member has their own hours. */
  customHours: boolean;
  timeOff: TimeOffRecord[];
}

export interface Board {
  timeZone: string;
  from: string;
  to: string;
  /** Instants covering the requested local dates: [rangeStart, rangeEnd). */
  rangeStart: Date;
  rangeEnd: Date;
  businessHours: WorkingHoursEntry[];
  lanes: BoardLane[];
  jobs: JobView[];
  unscheduled: JobView[];
}

/** Lane order: technicians first, then office staff who have visits; alphabetical within a role. */
const ROLE_ORDER: Record<Role, number> = { technician: 0, dispatcher: 1, admin: 2, owner: 3 };

function lanesFor(
  members: MemberRecord[],
  jobs: JobView[],
  timeOff: TimeOffRecord[],
  businessHours: WorkingHoursEntry[],
  onlyMember?: string,
): BoardLane[] {
  const withVisits = new Set(jobs.flatMap((j) => j.assignees.map((a) => a.memberId)));
  return members
    .filter((m) => (onlyMember ? m.id === onlyMember : m.role === "technician" || withVisits.has(m.id)))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
    .map((m) => ({
      member: { id: m.id, name: m.name, role: m.role, skills: m.skills },
      workingHours: effectiveHours(m.workingHours, businessHours),
      customHours: m.workingHours !== null,
      timeOff: timeOff.filter((t) => t.memberId === m.id),
    }));
}

/** Everything the board needs for a date range in the organization's time zone (at most 31 days). */
export async function getBoard(
  ctx: ServiceContext,
  raw: unknown,
  opts: { unscheduledLimit?: number } = {},
): Promise<Board> {
  assertCan(ctx.actor, "schedule.view");
  const q = parseInput(scheduleQuerySchema, raw);
  const org = await ctx.store.organization.get();
  const rangeStart = zonedInstant(q.from, 0, org.timezone);
  const rangeEnd = zonedInstant(shiftDate(q.to, 1), 0, org.timezone);
  const members = await ctx.store.members.list();
  if (q.member && !members.some((m) => m.id === q.member)) throw new NotFoundError("Member");
  const [jobs, timeOff, unscheduled] = await Promise.all([
    ctx.store.schedule.scheduled({ from: rangeStart, to: rangeEnd, memberId: q.member }),
    ctx.store.availability.listTimeOff({
      from: rangeStart,
      to: rangeEnd,
      memberIds: q.member ? [q.member] : undefined,
    }),
    (opts.unscheduledLimit ?? 50) > 0 ? ctx.store.schedule.unscheduled(opts.unscheduledLimit ?? 50) : [],
  ]);
  return {
    timeZone: org.timezone,
    from: q.from,
    to: q.to,
    rangeStart,
    rangeEnd,
    businessHours: org.businessHours,
    lanes: lanesFor(members, jobs, timeOff, org.businessHours, q.member),
    jobs,
    unscheduled,
  };
}

/** The signed-in member's assigned visits from today through the next seven days (TEC-01, `GET /me/agenda`). */
export async function getAgenda(ctx: ServiceContext, days = 7) {
  assertCan(ctx.actor, "jobs.view", { assigned: true });
  const org = await ctx.store.organization.get();
  const from = localDateOf(ctx.now, org.timezone);
  const to = shiftDate(from, days);
  const jobs = await ctx.store.schedule.scheduled({
    from: zonedInstant(from, 0, org.timezone),
    to: zonedInstant(shiftDate(to, 1), 0, org.timezone),
    memberId: ctx.actor.memberId,
  });
  return { timeZone: org.timezone, from, to, jobs };
}

// ------------------------------------------------------------------ availability (SCH-04)

/** Every assignable member with their hours, skills and time off from two weeks ago onward. */
export async function getTeamAvailability(ctx: ServiceContext) {
  assertCan(ctx.actor, "availability.manage");
  const org = await ctx.store.organization.get();
  const members = (await ctx.store.members.list()).sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name),
  );
  const timeOff = await ctx.store.availability.listTimeOff({
    from: new Date(ctx.now.getTime() - 14 * 86_400_000),
    // No upper bound: time off booked years ahead still shows (and can be removed).
    to: new Date(Date.UTC(9999, 11, 31)),
  });
  return {
    timeZone: org.timezone,
    businessHours: org.businessHours,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      skills: m.skills,
      workingHours: m.workingHours,
      timeOff: timeOff.filter((t) => t.memberId === m.id),
    })),
  };
}

export async function updateMemberAvailability(ctx: ServiceContext, memberId: string, raw: unknown) {
  assertCan(ctx.actor, "availability.manage");
  const input = parseInput(memberAvailabilityUpdateSchema, raw);
  const member = await ctx.store.members.get(memberId);
  if (!member) throw new NotFoundError("Member");
  const ok = await ctx.store.availability.updateMember(memberId, {
    ...(input.working_hours !== undefined && {
      workingHours: input.working_hours
        ? [...input.working_hours].sort((a, b) => a.day - b.day || a.open.localeCompare(b.open))
        : null,
    }),
    ...(input.skills !== undefined && { skills: [...new Set(input.skills)].sort() }),
  });
  if (!ok) throw new NotFoundError("Member");
  return (await ctx.store.members.get(memberId))!;
}

export async function createTimeOff(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "availability.manage");
  const input = parseInput(timeOffCreateSchema, raw);
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);
  if (endsAt <= startsAt) {
    throw new ValidationError("End must be after start", [
      { path: "ends_at", message: "End must be after start" },
    ]);
  }
  if (!(await ctx.store.members.get(input.member_id))) throw new NotFoundError("Member");
  return ctx.store.availability.createTimeOff({
    memberId: input.member_id,
    startsAt,
    endsAt,
    reason: input.reason ?? null,
    createdBy: ctx.actor.userId,
  });
}

export async function deleteTimeOff(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "availability.manage");
  if (!(await ctx.store.availability.removeTimeOff(id))) throw new NotFoundError("Time off");
}
