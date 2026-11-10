import { jobs } from "@fieldops/core";
import { apiRoute, ifMatchVersion, jobEtag } from "@/server/api/handler";
import { toJobDetailDto } from "@/server/api/serialize";

type Params = { id: string };

export const GET = apiRoute<Params>(async ({ req, params, ctx }) => {
  const job = await jobs.getJob(ctx, params.id);
  const etag = jobEtag(job.version);
  if (req.headers.get("if-none-match") === etag) return { status: 304, headers: { ETag: etag } };
  return { body: toJobDetailDto(job, await jobs.getJobActions(ctx, job)), headers: { ETag: etag } };
});

export const PATCH = apiRoute<Params>(async ({ req, params, body, ctx }) => {
  const job = await jobs.updateJob(ctx, params.id, body ?? {}, ifMatchVersion(req));
  return {
    body: toJobDetailDto(job, await jobs.getJobActions(ctx, job)),
    headers: { ETag: jobEtag(job.version) },
  };
});

export const DELETE = apiRoute<Params>(async ({ params, ctx }) => {
  await jobs.deleteJob(ctx, params.id);
  return { status: 204 };
});
