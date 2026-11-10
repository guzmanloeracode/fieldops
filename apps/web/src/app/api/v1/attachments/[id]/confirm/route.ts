import { jobs } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { ApiProblem } from "@/server/api/problem";
import { toAttachmentDto } from "@/server/api/serialize";

/** Marks an uploaded attachment as ready once the file exists in storage. */
export const POST = apiRoute<{ id: string }>(async ({ params, ctx }) => {
  if (!ctx.files) throw new ApiProblem(503, "unavailable", "File storage is not configured on this server");
  const attachment = await jobs.confirmAttachmentUpload(ctx, params.id);
  return { body: toAttachmentDto(attachment) };
});
