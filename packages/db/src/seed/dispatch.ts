import { availability, type WorkingHours } from "@fieldops/core";
import { and, eq, sql } from "drizzle-orm";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";

// Technician working hours, skills and time off (SCH-04). Most technicians follow the business hours; a
// few have their own patterns so the board shows shading, a part-timer and a Saturday shift. Upcoming
// visits that the new hours or time off would make conflict are handed to a free, qualified colleague,
// so the demo board starts clean; anything that can't move stays as a visible conflict.

type Hours = WorkingHours[];
const days = (list: number[], open: string, close: string): Hours =>
  list.map((day) => ({ day, open, close }));

/**
 * Own hours per technician (by first name). Unlisted technicians follow the business hours. The patterns
 * stay close to how the core seed books visits (08:00–18:00), so only a few upcoming visits need to move.
 */
const HOURS: Record<string, Record<string, Hours>> = {
  "acme-air": {
    // Luis works long days and covers Saturday mornings for installs and emergencies.
    Luis: [...days([1, 2, 3, 4, 5], "08:00", "18:00"), ...days([6], "08:00", "14:00")],
    // Grace is part-time: Monday, Wednesday and Friday.
    Grace: days([1, 3, 5], "08:00", "17:00"),
    // Hannah starts early on weekdays.
    Hannah: days([1, 2, 3, 4, 5], "07:00", "18:00"),
  },
  "acme-teknik": {
    // Rizky works Tuesday to Saturday.
    Rizky: days([2, 3, 4, 5, 6], "08:00", "17:00"),
    // Dewi is part-time, Monday to Thursday.
    Dewi: days([1, 2, 3, 4], "08:00", "17:00"),
  },
};

/** Extra skills, so a few service types have more than one qualified technician. */
const EXTRA_SKILLS: Record<string, Record<string, string[]>> = {
  "acme-air": { Luis: ["electrical"], Sofia: ["ac"] },
  "acme-teknik": { Dewi: ["refrigerant"] },
};

interface TimeOffPlan {
  /** First name, or the least busy technician tomorrow (never a demo account). */
  who: string | "least_busy_tomorrow";
  /** Days from the seed's "today" (local), or a Monday after the seeded week ahead. */
  from: number | "monday_after_next";
  /** Whole days. */
  length: number;
  reason: string;
}

// Someone is off tomorrow (the least busy technician, so only a few visits need a new owner) and someone
// has a vacation booked after the seeded week; older entries make the history look lived in.
const TIME_OFF: Record<string, TimeOffPlan[]> = {
  "acme-air": [
    { who: "least_busy_tomorrow", from: 1, length: 1, reason: "Personal day" },
    { who: "Ethan", from: "monday_after_next", length: 3, reason: "Vacation" },
    { who: "Jamal", from: -23, length: 2, reason: "Sick leave" },
    { who: "Hannah", from: -41, length: 1, reason: "Dentist" },
    { who: "Sofia", from: -64, length: 5, reason: "Vacation" },
  ],
  "acme-teknik": [
    { who: "least_busy_tomorrow", from: 1, length: 1, reason: "Izin keluarga" },
    { who: "Wahyu", from: "monday_after_next", length: 3, reason: "Cuti tahunan" },
    { who: "Dewi", from: -30, length: 3, reason: "Cuti sakit" },
  ],
};

export async function seedDispatch(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 1);
  const tz = ctx.timeZone;
  const key = ctx.spec.key;
  const first = (name: string) => name.split(" ")[0]!;
  const technicians = ctx.members.filter((m) => m.role === "technician");
  const byFirst = new Map(technicians.map((m) => [first(m.name), m]));

  // ------------------------------------------------------------ hours and skills
  const [org] = await ctx.tx
    .select({ businessHours: s.organization.businessHours })
    .from(s.organization)
    .where(eq(s.organization.id, ctx.orgId));
  const businessHours = (org?.businessHours ?? []) as Hours;
  const hoursOf = new Map<string, Hours>();
  const skillsOf = new Map<string, string[]>();
  for (const m of technicians) {
    const own = HOURS[key]?.[first(m.name)] ?? null;
    const skills = [...new Set([...m.skills, ...(EXTRA_SKILLS[key]?.[first(m.name)] ?? [])])].sort();
    hoursOf.set(m.id, availability.effectiveHours(own, businessHours));
    skillsOf.set(m.id, skills);
    if (own || skills.length !== m.skills.length) {
      await ctx.tx
        .update(s.member)
        .set({ workingHours: own, skills })
        .where(and(eq(s.member.organizationId, ctx.orgId), eq(s.member.id, m.id)));
      m.skills = skills;
    }
  }

  // ------------------------------------------------------------ time off
  // "Today" matches the core seed's anchor: the local date eight hours after the reset.
  const today = availability.localDateOf(new Date(ctx.now.getTime() + 8 * 3_600_000), tz);
  const dayStart = (offset: number) =>
    availability.zonedInstant(availability.shiftDate(today, offset), 0, tz);
  const untilNextMonday = (8 - availability.dayOfWeek(today)) % 7 || 7;
  const dispatcher = ctx.members.find((m) => m.role === "dispatcher") ?? ctx.members[0]!;
  const demo = new Set(ctx.spec.team.filter((m) => m.demo).map((m) => m.name));
  const tomorrow = availability.shiftDate(today, 1);
  const loadTomorrow = (memberId: string) =>
    ctx.jobs.filter(
      (j) =>
        j.scheduledStart &&
        availability.localDateOf(j.scheduledStart, tz) === tomorrow &&
        j.assignees.some((a) => a.memberId === memberId),
    ).length;
  const leastBusy = technicians
    .filter((m) => !demo.has(m.name))
    .map((m) => ({ m, load: loadTomorrow(m.id) }))
    .sort((a, b) => a.load - b.load || a.m.name.localeCompare(b.m.name))[0]?.m;
  const entries: (typeof s.timeOff.$inferInsert)[] = [];
  for (const p of TIME_OFF[key] ?? []) {
    const m = p.who === "least_busy_tomorrow" ? leastBusy : byFirst.get(p.who);
    if (!m) continue;
    const from = p.from === "monday_after_next" ? untilNextMonday + 7 : p.from;
    const startsAt = dayStart(from);
    entries.push({
      organizationId: ctx.orgId,
      memberId: m.id,
      startsAt,
      endsAt: dayStart(from + p.length),
      reason: p.reason,
      createdBy: dispatcher.userId,
      createdAt: new Date(
        Math.min(ctx.now.getTime(), startsAt.getTime()) - f.number.int({ min: 3, max: 20 }) * 86_400_000,
      ),
    });
  }
  if (entries.length) await ctx.tx.insert(s.timeOff).values(entries);

  // ------------------------------------------------------------ keep upcoming visits conflict-free
  const required = new Map(ctx.serviceTypes.map((st) => [st.id, st.requiredSkills]));
  const busy = new Map<string, availability.TimeRange[]>();
  for (const j of ctx.jobs) {
    // Canceled visits count too: the seed never double-books anyone, not even on paper.
    if (!j.scheduledStart || !j.scheduledEnd) continue;
    for (const a of j.assignees) {
      busy.set(a.memberId, [
        ...(busy.get(a.memberId) ?? []),
        { start: j.scheduledStart, end: j.scheduledEnd },
      ]);
    }
  }
  const offOf = (memberId: string) =>
    entries
      .filter((e) => e.memberId === memberId)
      .map((e) => ({ startsAt: e.startsAt as Date, endsAt: e.endsAt as Date }));
  const fits = (memberId: string, visit: availability.TimeRange, ignore?: availability.TimeRange) =>
    availability.isWithinWorkingHours(hoursOf.get(memberId) ?? businessHours, visit, tz) &&
    availability.overlappingTimeOff(offOf(memberId), visit).length === 0 &&
    !(busy.get(memberId) ?? []).some((b) => b !== ignore && availability.rangesOverlap(b, visit));
  // The core seed books visits from 08:00 to 18:00 and on some weekends; for people on business hours that
  // stays as booked overtime. Only time off and the patterns above make a visit move.
  const ownHours = new Set(technicians.filter((m) => HOURS[key]?.[first(m.name)]).map((m) => m.id));
  const mustMove = (memberId: string, visit: availability.TimeRange) =>
    availability.overlappingTimeOff(offOf(memberId), visit).length > 0 ||
    (ownHours.has(memberId) &&
      !availability.isWithinWorkingHours(hoursOf.get(memberId) ?? businessHours, visit, tz));

  // Upcoming visits that the hours or time off now rule out: a helper is dropped, otherwise a free and
  // qualified colleague takes over, otherwise the visit goes back to the unscheduled queue for a dispatcher.
  // Each change is a real timeline event by the dispatcher, a little before the reset.
  const fromToday = dayStart(0);
  const nameOf = new Map(ctx.members.map((m) => [m.id, m.name]));
  const eventAt = (j: (typeof ctx.jobs)[number]) => {
    const last = Math.max(...j.events.map((e) => (e.createdAt as Date).getTime()));
    return new Date(
      Math.min(ctx.now.getTime() - 60_000, Math.max(last + 60_000, ctx.now.getTime() - 2 * 86_400_000)),
    );
  };
  const events: (typeof s.jobEvent.$inferInsert)[] = [];
  for (const j of ctx.jobs) {
    if (j.status !== "scheduled" || !j.scheduledStart || !j.scheduledEnd || j.scheduledStart < fromToday)
      continue;
    const visit = { start: j.scheduledStart, end: j.scheduledEnd };
    const needs = (j.serviceTypeId && required.get(j.serviceTypeId)) || [];
    let changed = false;
    for (const a of [...j.assignees]) {
      const mine = (busy.get(a.memberId) ?? []).find(
        (b) => b.start.getTime() === visit.start.getTime() && b.end.getTime() === visit.end.getTime(),
      );
      if (!mustMove(a.memberId, visit)) continue;
      const release = () =>
        busy.set(
          a.memberId,
          (busy.get(a.memberId) ?? []).filter((b) => b !== mine),
        );
      if (j.assignees.length > 1) {
        // A helper who isn't available is simply taken off the visit.
        j.assignees = j.assignees.filter((x) => x !== a);
        if (a.isLead) j.assignees[0]!.isLead = true;
        release();
        changed = true;
        continue;
      }
      const replacement = f.helpers
        .shuffle(technicians)
        .find(
          (t) =>
            !j.assignees.some((x) => x.memberId === t.id) &&
            availability.missingSkills(needs, skillsOf.get(t.id) ?? []).length === 0 &&
            fits(t.id, visit),
        );
      release();
      if (replacement) {
        a.memberId = replacement.id;
        busy.set(replacement.id, [...(busy.get(replacement.id) ?? []), visit]);
        changed = true;
        continue;
      }
      // Nobody can take it: back to the queue.
      const at = eventAt(j);
      j.assignees = [];
      j.status = "new";
      j.scheduledStart = null;
      j.scheduledEnd = null;
      const event = {
        organizationId: ctx.orgId,
        jobId: j.id,
        type: "status_changed",
        fromStatus: "scheduled",
        toStatus: "new",
        actorUserId: dispatcher.userId,
        payload: { transition: "unschedule", reason: `${nameOf.get(a.memberId)} isn't available` },
        createdAt: at,
      };
      events.push(event);
      j.events.push(event);
      await ctx.tx
        .update(s.job)
        .set({
          status: "new",
          scheduledStart: null,
          scheduledEnd: null,
          version: sql`${s.job.version} + 1`,
          updatedAt: at,
        })
        .where(and(eq(s.job.organizationId, ctx.orgId), eq(s.job.id, j.id)));
      changed = true;
      break;
    }
    if (!changed) continue;
    await ctx.tx
      .delete(s.jobAssignment)
      .where(and(eq(s.jobAssignment.organizationId, ctx.orgId), eq(s.jobAssignment.jobId, j.id)));
    if (j.assignees.length === 0) continue;
    await ctx.tx
      .insert(s.jobAssignment)
      .values(
        j.assignees.map((a) => ({
          organizationId: ctx.orgId,
          jobId: j.id,
          memberId: a.memberId,
          isLead: a.isLead,
        })),
      );
    const at = eventAt(j);
    const event = {
      organizationId: ctx.orgId,
      jobId: j.id,
      type: "assigned",
      fromStatus: null,
      toStatus: null,
      actorUserId: dispatcher.userId,
      payload: {
        member_ids: j.assignees.map((a) => a.memberId),
        lead_member_id: j.assignees.find((a) => a.isLead)?.memberId ?? j.assignees[0]!.memberId,
        scheduled_start: visit.start.toISOString(),
        scheduled_end: visit.end.toISOString(),
      },
      createdAt: at,
    };
    events.push(event);
    j.events.push(event);
    await ctx.tx
      .update(s.job)
      .set({ version: sql`${s.job.version} + 1`, updatedAt: at })
      .where(and(eq(s.job.organizationId, ctx.orgId), eq(s.job.id, j.id)));
  }
  if (events.length) await ctx.tx.insert(s.jobEvent).values(events);
}
