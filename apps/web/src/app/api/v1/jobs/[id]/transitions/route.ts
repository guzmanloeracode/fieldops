import { jobs } from "@fieldops/core";
import { apiRoute, ifMatchVersion, jobEtag } from "@/server/api/handler";
import { toJobDetailDto } from "@/server/api/serialize";

/** Moves the job through its lifecycle (JOB-02). Invalid moves return 409 invalid-transition. */
export const POST = apiRoute<{ id: string }>(async ({ req, params, body, ctx }) => {
  const job = await jobs.transitionJob(ctx, params.id, body, ifMatchVersion(req));
  return {
    body: toJobDetailDto(job, await jobs.getJobActions(ctx, job)),
    headers: { ETag: jobEtag(job.version) },
  };
});
