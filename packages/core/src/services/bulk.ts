import { STATUS_LABELS } from "../domain/job-status";
import { jobBulkActionSchema, type JobBulkAction } from "@fieldops/shared";
import { DomainError } from "../domain/errors";
import { formatJobNumber } from "../domain/numbering";
import { assertCan, type Actor } from "../domain/permissions";
import { assignJob, getJob, transitionJob } from "./jobs";
import { parseInput } from "./validate";
import type { ServiceContext } from "./types";

// Bulk actions on the jobs table (JOB-04). Each job runs through the same service as a single change, in its
// own transaction, so one rejected job (an overlap, an invalid status move) never blocks or undoes the rest.

export interface BulkItemResult {
  id: string;
  number: string | null;
  ok: boolean;
  /** Why the job was skipped. */
  message?: string;
}

export interface BulkResult {
  action: JobBulkAction["action"];
  updated: number;
  skipped: number;
  results: BulkItemResult[];
}

/** Runs one job's change in its own tenant transaction. */
export type ItemRunner = <T>(fn: (ctx: ServiceContext) => Promise<T>) => Promise<T>;

/** A rejected job, rethrown so its transaction rolls back, with the job number for the report. */
class ItemError extends Error {
  constructor(
    readonly number: string,
    readonly original: DomainError,
  ) {
    super(original.message);
  }
}

async function applyOne(ctx: ServiceContext, input: JobBulkAction, id: string): Promise<BulkItemResult> {
  const job = await getJob(ctx, id);
  const number = formatJobNumber(job.number);
  try {
    return await change(ctx, input, job, number);
  } catch (err) {
    throw err instanceof DomainError ? new ItemError(number, err) : err;
  }
}

async function change(
  ctx: ServiceContext,
  input: JobBulkAction,
  job: Awaited<ReturnType<typeof getJob>>,
  number: string,
): Promise<BulkItemResult> {
  if (input.action === "assign") {
    const lead = job.assignees.find((a) => a.isLead);
    if (lead?.memberId === input.member_id) {
      return { id: job.id, number, ok: false, message: "Already assigned" };
    }
    const helpers = job.assignees
      .filter((a) => !a.isLead && a.memberId !== input.member_id)
      .map((a) => a.memberId);
    await assignJob(ctx, job.id, {
      member_ids: [input.member_id, ...helpers],
      lead_member_id: input.member_id,
      scheduled_start: job.scheduledStart?.toISOString() ?? null,
      scheduled_end: job.scheduledEnd?.toISOString() ?? null,
    });
    return { id: job.id, number, ok: true };
  }
  if (job.status === input.to) {
    return { id: job.id, number, ok: false, message: `Already ${STATUS_LABELS[input.to].toLowerCase()}` };
  }
  await transitionJob(ctx, job.id, {
    to: input.to,
    reason: input.reason ?? null,
    hold_reason: input.hold_reason ?? null,
  });
  return { id: job.id, number, ok: true };
}

export async function runBulkJobAction(
  actor: Pick<Actor, "role">,
  raw: unknown,
  runItem: ItemRunner,
): Promise<BulkResult> {
  const input = parseInput(jobBulkActionSchema, raw);
  assertCan(actor, input.action === "assign" ? "jobs.assign" : "jobs.update");
  const results: BulkItemResult[] = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      results.push(await runItem((ctx) => applyOne(ctx, input, id)));
    } catch (err) {
      if (err instanceof ItemError) results.push({ id, number: err.number, ok: false, message: err.message });
      else if (err instanceof DomainError)
        results.push({ id, number: null, ok: false, message: err.message });
      else throw err;
    }
  }
  const updated = results.filter((r) => r.ok).length;
  return { action: input.action, updated, skipped: results.length - updated, results };
}
