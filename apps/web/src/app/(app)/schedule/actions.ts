"use server";
import { formatJobNumber, jobs, schedule } from "@fieldops/core";
import type { JobAssignmentInput } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

// Server actions for the dispatch board (SCH-01–03) and team availability (SCH-04).

/** Assigns and schedules from the board. A 409 carries `details.conflicts` for the override dialog. */
export async function boardAssignAction(jobId: string, input: JobAssignmentInput) {
  const result = await action(() => runService((ctx) => jobs.assignJob(ctx, jobId, input)));
  if (!result.ok) return result;
  revalidatePath("/schedule");
  revalidatePath(`/jobs/${formatJobNumber(result.data.number)}`);
  return {
    ok: true as const,
    data: {
      status: result.data.status,
      start: result.data.scheduledStart?.toISOString() ?? null,
      end: result.data.scheduledEnd?.toISOString() ?? null,
    },
  };
}

/** Conflicts a drop would raise, checked while dragging. Nothing is saved. */
export async function previewConflictsAction(jobId: string, input: JobAssignmentInput) {
  return action(() => runService((ctx) => jobs.previewConflicts(ctx, jobId, input)));
}

export async function updateAvailabilityAction(memberId: string, input: unknown) {
  const result = await action(() =>
    runService((ctx) => schedule.updateMemberAvailability(ctx, memberId, input)),
  );
  if (result.ok) revalidatePath("/schedule", "layout");
  return result.ok ? { ok: true as const, data: null } : result;
}

export async function createTimeOffAction(input: unknown) {
  const result = await action(() => runService((ctx) => schedule.createTimeOff(ctx, input)));
  if (result.ok) revalidatePath("/schedule", "layout");
  return result.ok ? { ok: true as const, data: { id: result.data.id } } : result;
}

export async function deleteTimeOffAction(id: string) {
  const result = await action(() => runService((ctx) => schedule.deleteTimeOff(ctx, id)));
  if (result.ok) revalidatePath("/schedule", "layout");
  return result;
}
