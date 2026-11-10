import { signatures } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toAttachmentDto } from "@/server/api/serialize";

/**
 * Links an uploaded signature image to the job (JOB-10). Upload it first through
 * `POST /jobs/{id}/attachments` with `kind: "signature"`, then call this instead of confirming the upload.
 */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const signature = await signatures.captureSignature(ctx, params.id, body);
  const url = ctx.files
    ? await ctx.files.presignGet(signature.storageKey, { downloadName: signature.fileName })
    : null;
  return { status: 201, body: toAttachmentDto({ ...signature, url, thumbUrl: null }) };
});
