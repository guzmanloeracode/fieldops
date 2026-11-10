import { CONFLICT_KINDS, type ConflictDto } from "@fieldops/shared";
import {
  describeHours,
  effectiveHours,
  isWithinWorkingHours,
  localDateOf,
  missingSkills,
  overlappingTimeOff,
} from "../domain/availability";
import { formatJobNumber } from "../domain/numbering";
import type { JobView, ServiceContext } from "./types";

// Scheduling conflicts (SCH-03): overlap with another visit, outside working hours, time off and missing
// skills. They are warnings a dispatcher can override with a reason, so this module only reports them.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Conflicts for assigning `memberIds` to the job in the given window. Missing skills are checked even
 * without a window; the time-based checks need one. Ordered by member, then kind.
 */
export async function detectConflicts(
  ctx: ServiceContext,
  job: Pick<JobView, "id" | "serviceTypeId">,
  memberIds: readonly string[],
  start: Date | null,
  end: Date | null,
): Promise<ConflictDto[]> {
  if (memberIds.length === 0) return [];
  const members = new Map((await ctx.store.members.list()).map((m) => [m.id, m]));
  const serviceType = job.serviceTypeId ? await ctx.store.serviceTypes.get(job.serviceTypeId) : null;
  const required = serviceType?.requiredSkills ?? [];
  const window = start && end ? { start, end } : null;
  const org = window ? await ctx.store.organization.get() : null;
  const timeOff = window
    ? await ctx.store.availability.listTimeOff({
        from: window.start,
        to: window.end,
        memberIds: [...memberIds],
      })
    : [];

  const out: ConflictDto[] = [];
  for (const memberId of memberIds) {
    const m = members.get(memberId);
    if (!m) continue;
    const base = { member_id: m.id, member_name: m.name };

    if (window && org) {
      const overlapping = await ctx.store.jobs.overlapping(m.id, window.start, window.end, job.id);
      if (overlapping.length) {
        const numbers = overlapping.map((j) => formatJobNumber(j.number));
        out.push({
          ...base,
          kind: "overlap",
          message: `${m.name} has another visit at this time (${numbers.join(", ")})`,
          job_numbers: numbers,
        });
      }
      const hours = effectiveHours(m.workingHours, org.businessHours);
      if (!isWithinWorkingHours(hours, window, org.timezone)) {
        const date = localDateOf(window.start, org.timezone);
        const today = describeHours(hours, date);
        const day = DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
        out.push({
          ...base,
          kind: "outside_hours",
          message: today ? `${m.name} works ${today} on ${day}s` : `${m.name} doesn't work on ${day}s`,
        });
      }
      const off = overlappingTimeOff(
        timeOff.filter((t) => t.memberId === m.id),
        window,
      );
      if (off.length) {
        const reason = off.find((t) => t.reason)?.reason;
        out.push({
          ...base,
          kind: "time_off",
          message: `${m.name} is off at this time${reason ? ` (${reason})` : ""}`,
        });
      }
    }

    const missing = missingSkills(required, m.skills);
    if (missing.length) {
      out.push({
        ...base,
        kind: "missing_skills",
        message: `${m.name} doesn't have the required skills: ${missing.join(", ")}`,
        missing_skills: missing,
      });
    }
  }
  const order = (k: ConflictDto["kind"]) => CONFLICT_KINDS.indexOf(k);
  const memberOrder = (id: string) => memberIds.indexOf(id);
  return out.sort(
    (a, b) => memberOrder(a.member_id) - memberOrder(b.member_id) || order(a.kind) - order(b.kind),
  );
}

/** One sentence for an error message: the single conflict, or a count. */
export function conflictSummary(conflicts: readonly ConflictDto[]): string {
  if (conflicts.length === 1) return conflicts[0]!.message;
  return `This assignment has ${conflicts.length} scheduling conflicts`;
}
