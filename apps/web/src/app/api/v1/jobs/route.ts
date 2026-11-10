import { jobs } from "@fieldops/core";
import { jobListQuerySchema } from "@fieldops/shared";
import { parseInput } from "@fieldops/core";
import { apiRoute, jobEtag, queryObject } from "@/server/api/handler";
import { toJobDto } from "@/server/api/serialize";

export const GET = apiRoute(async ({ url, ctx }) => {
  const query = parseInput(jobListQuerySchema, queryObject(url));
  const page = await jobs.listJobs(ctx, { ...query, page: undefined });
  return { body: { data: page.rows.map(toJobDto), next_cursor: page.nextCursor } };
});

export const POST = apiRoute(async ({ body, ctx }) => {
  const job = await jobs.createJob(ctx, body);
  return {
    status: 201,
    body: toJobDto(job),
    headers: { Location: `/api/v1/jobs/${job.id}`, ETag: jobEtag(job.version) },
  };
});
