import { timeEntryCreateSchema, timeEntryUpdateSchema, type TimeEntryKind } from "@fieldops/shared";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import type { TransitionName } from "../domain/job-status";
import { assertCan, seesOnlyAssigned } from "../domain/permissions";
import { minutesBetween } from "../domain/schedule";
import type { TimeEntryRecord } from "./fieldwork-types";
import { getJob, isAssigned } from "./job-access";
import type { JobView, ServiceContext } from "./types";
import { parseInput } from "./validate";

// Travel and work time recorded from status changes, editable with a reason (TEC-04).

/** Clock changes per transition. "close-all" stops everyone's running entries on the job. */
const CLOCK: Partial<Record<TransitionName, { open?: TimeEntryKind; close: "member" | "all" }>> = {
  depart: { open: "travel", close: "member" },
  start: { open: "work", close: "member" },
  resume: { open: "work", close: "member" },
  hold: { close: "all" },
  complete: { close: "all" },
  cancel: { close: "all" },
  unschedule: { close: "all" },
};

/** Whose clock a status change runs: the acting member if assigned, otherwise the lead (or first) assignee. */
export function clockMember(ctx: ServiceContext, job: Pick<JobView, "assignees">): string | null {
  if (isAssigned(ctx, job)) return ctx.actor.memberId;
  return (job.assignees.find((a) => a.isLead) ?? job.assignees[0])?.memberId ?? null;
}

/** Called by transitionJob after a status change. Returns the entry it opened, if any. */
export async function recordTransition(
  ctx: ServiceContext,
  job: Pick<JobView, "id" | "assignees">,
  transition: TransitionName,
): Promise<TimeEntryRecord | null> {
  const rule = CLOCK[transition];
  if (!rule) return null;
  const memberId = clockMember(ctx, job);
  if (rule.close === "all") await ctx.store.timeEntries.closeOpen(job.id, ctx.now);
  else if (memberId) await ctx.store.timeEntries.closeOpen(job.id, ctx.now, memberId);
  if (!rule.open || !memberId) return null;
  return ctx.store.timeEntries.create({
    jobId: job.id,
    memberId,
    kind: rule.open,
    startedAt: ctx.now,
    endedAt: null,
    source: "status",
  });
}

export interface TimeTotals {
  member: { id: string; name: string };
  travelMin: number;
  workMin: number;
  running: TimeEntryKind | null;
}

/** Minutes of an entry; a running entry counts up to `now`. */
export function entryMinutes(entry: Pick<TimeEntryRecord, "startedAt" | "endedAt">, now: Date): number {
  return Math.max(0, minutesBetween(entry.startedAt, entry.endedAt ?? now));
}

export function totals(entries: readonly TimeEntryRecord[], now: Date): TimeTotals[] {
  const byMember = new Map<string, TimeTotals>();
  for (const e of entries) {
    const t = byMember.get(e.member.id) ?? { member: e.member, travelMin: 0, workMin: 0, running: null };
    if (e.kind === "travel") t.travelMin += entryMinutes(e, now);
    else t.workMin += entryMinutes(e, now);
    if (!e.endedAt) t.running = e.kind;
    byMember.set(e.member.id, t);
  }
  return [...byMember.values()];
}

export async function listTimeEntries(ctx: ServiceContext, jobId: string) {
  const job = await getJob(ctx, jobId);
  const entries = await ctx.store.timeEntries.listByJob(job.id);
  return { entries, totals: totals(entries, ctx.now) };
}

const LEEWAY_MS = 60_000;

function assertNotFuture(ctx: ServiceContext, date: Date, path: string) {
  if (date.getTime() > ctx.now.getTime() + LEEWAY_MS) {
    throw new ValidationError("Time can't be in the future", [{ path, message: "Can't be in the future" }]);
  }
}

/** Office roles edit anyone's time; technicians only their own, on jobs they're assigned to. */
function assertMayEdit(ctx: ServiceContext, job: JobView, memberId: string) {
  assertCan(ctx.actor, "time.edit", { assigned: isAssigned(ctx, job) });
  if (seesOnlyAssigned(ctx.actor) && memberId !== ctx.actor.memberId) throw new ForbiddenError();
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Corrects a recorded entry. The reason is required and shown in the timeline. */
export async function updateTimeEntry(ctx: ServiceContext, entryId: string, raw: unknown) {
  const input = parseInput(timeEntryUpdateSchema, raw);
  const entry = await ctx.store.timeEntries.get(entryId);
  if (!entry) throw new NotFoundError("Time entry");
  const job = await getJob(ctx, entry.jobId);
  assertMayEdit(ctx, job, entry.member.id);

  const startedAt = new Date(input.started_at);
  const endedAt = input.ended_at ? new Date(input.ended_at) : null;
  assertNotFuture(ctx, startedAt, "started_at");
  if (endedAt) assertNotFuture(ctx, endedAt, "ended_at");
  if (!endedAt && entry.endedAt) {
    throw new ValidationError("A finished entry needs an end time", [
      { path: "ended_at", message: "Enter when it ended" },
    ]);
  }
  const updated = (await ctx.store.timeEntries.update(entry.id, {
    startedAt,
    endedAt,
    editedReason: input.reason,
    editedBy: ctx.actor.userId,
  }))!;
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "time_edited",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: {
      action: "edited",
      entry_id: entry.id,
      member_id: entry.member.id,
      member_name: entry.member.name,
      kind: entry.kind,
      before: { started_at: iso(entry.startedAt), ended_at: iso(entry.endedAt) },
      after: { started_at: iso(startedAt), ended_at: iso(endedAt) },
      reason: input.reason,
    },
  });
  return updated;
}

/** Adds time that no status change recorded, for example travel back to the shop. */
export async function addTimeEntry(ctx: ServiceContext, jobId: string, raw: unknown) {
  const input = parseInput(timeEntryCreateSchema, raw);
  const job = await getJob(ctx, jobId);
  const memberId = input.member_id ?? ctx.actor.memberId;
  assertMayEdit(ctx, job, memberId);
  const member = await ctx.store.members.get(memberId);
  if (!member) {
    throw new ValidationError("Unknown member", [{ path: "member_id", message: "Unknown member" }]);
  }
  const startedAt = new Date(input.started_at);
  const endedAt = new Date(input.ended_at);
  assertNotFuture(ctx, endedAt, "ended_at");
  const entry = await ctx.store.timeEntries.create({
    jobId: job.id,
    memberId,
    kind: input.kind,
    startedAt,
    endedAt,
    source: "manual",
    editedReason: input.reason,
    editedBy: ctx.actor.userId,
  });
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "time_edited",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: {
      action: "added",
      entry_id: entry.id,
      member_id: memberId,
      member_name: member.name,
      kind: input.kind,
      after: { started_at: iso(startedAt), ended_at: iso(endedAt) },
      reason: input.reason,
    },
  });
  return entry;
}
