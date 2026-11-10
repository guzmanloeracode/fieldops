import { jobs } from "@fieldops/core";
import { apiRoute, jobEtag } from "@/server/api/handler";
import { toJobDetailDto } from "@/server/api/serialize";

/** Replaces the assigned technicians and the visit window in one call. */
export const PUT = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const job = await jobs.assignJob(ctx, params.id, body);
  return {
    body: toJobDetailDto(job, await jobs.getJobActions(ctx, job)),
    headers: { ETag: jobEtag(job.version) },
  };
});
