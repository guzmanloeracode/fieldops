import { NotFoundError } from "../domain/errors";
import { parseJobNumber } from "../domain/numbering";
import { assertCan, seesOnlyAssigned } from "../domain/permissions";
import type { JobView, ServiceContext } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in member is assigned to the job. */
export function isAssigned(ctx: ServiceContext, job: Pick<JobView, "assignees">): boolean {
  return job.assignees.some((a) => a.memberId === ctx.actor.memberId);
}

/** Loads a job by id or number ("JOB-000123"). Jobs a technician isn't assigned to are reported as not found. */
export async function getJob(ctx: ServiceContext, idOrNumber: string): Promise<JobView> {
  let job: JobView | null = null;
  if (UUID.test(idOrNumber)) job = await ctx.store.jobs.get(idOrNumber);
  else {
    const n = parseJobNumber(idOrNumber);
    if (n) job = await ctx.store.jobs.getByNumber(n);
  }
  if (!job) throw new NotFoundError("Job");
  const assigned = isAssigned(ctx, job);
  if (seesOnlyAssigned(ctx.actor) && !assigned) throw new NotFoundError("Job");
  assertCan(ctx.actor, "jobs.view", { assigned });
  return job;
}

/** Field work is only possible while the job is open. */
export function isClosed(job: Pick<JobView, "status">): boolean {
  return job.status === "completed" || job.status === "canceled";
}
