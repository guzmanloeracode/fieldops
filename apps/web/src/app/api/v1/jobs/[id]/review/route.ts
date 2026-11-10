import { ai, jobs } from "@fieldops/core";
import { apiRoute, jobEtag } from "@/server/api/handler";
import { toJobDetailDto } from "@/server/api/serialize";

/** Reviews a portal request (AI-01): applies chosen AI draft fields and, with `confirm`, clears needs_review. */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const { job } = await ai.reviewJob(ctx, params.id, body);
  return {
    body: toJobDetailDto(job, await jobs.getJobActions(ctx, job)),
    headers: { ETag: jobEtag(job.version) },
  };
});
