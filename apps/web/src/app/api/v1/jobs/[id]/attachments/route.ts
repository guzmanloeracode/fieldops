import { jobs } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { ApiProblem } from "@/server/api/problem";
import { toAttachmentDto, toUploadDto } from "@/server/api/serialize";

type Params = { id: string };

export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  const rows = await jobs.listAttachments(ctx, params.id);
  return { body: { data: rows.map(toAttachmentDto), next_cursor: null } };
});

/**
 * Starts an upload: returns a presigned URL to PUT the file straight to object storage. Call
 * POST /attachments/{id}/confirm once the upload has finished.
 */
export const POST = apiRoute<Params>(async ({ params, body, ctx }) => {
  if (!ctx.files) throw new ApiProblem(503, "unavailable", "File storage is not configured on this server");
  const upload = await jobs.requestAttachmentUpload(ctx, params.id, body);
  return { status: 201, body: toUploadDto(upload) };
});
