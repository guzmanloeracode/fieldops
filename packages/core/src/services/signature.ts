import { signatureCaptureSchema } from "@fieldops/shared";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { assertCan } from "../domain/permissions";
import { getJob, isAssigned, isClosed } from "./job-access";
import type { AttachmentRecord, ServiceContext } from "./types";
import { parseInput } from "./validate";

// Customer signature on completion (JOB-10). The image is uploaded like any attachment (kind "signature",
// caption = signer's name), then linked here.

const SIGNATURE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** The latest captured signature of a job, if any. */
export function latestSignature<T extends AttachmentRecord>(attachments: readonly T[]): T | null {
  return (
    attachments
      .filter((a) => a.kind === "signature" && a.status === "ready")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  );
}

export async function hasSignature(ctx: ServiceContext, jobId: string): Promise<boolean> {
  return latestSignature(await ctx.store.attachments.list(jobId)) !== null;
}

export async function captureSignature(ctx: ServiceContext, jobId: string, raw: unknown) {
  const input = parseInput(signatureCaptureSchema, raw);
  const job = await getJob(ctx, jobId);
  assertCan(ctx.actor, "jobs.work", { assigned: isAssigned(ctx, job) });
  if (isClosed(job)) throw new ConflictError("A completed or canceled job can't be signed");

  const attachment = await ctx.store.attachments.get(input.attachment_id);
  if (!attachment || attachment.jobId !== job.id) throw new NotFoundError("Attachment");
  if (attachment.kind !== "signature" || !SIGNATURE_TYPES.includes(attachment.mimeType)) {
    throw new ValidationError("This upload isn't a signature image", [
      { path: "attachment_id", message: 'Upload a PNG, JPEG or WebP with kind "signature"' },
    ]);
  }
  let ready = attachment;
  if (attachment.status !== "ready") {
    if (!ctx.files || !(await ctx.files.exists(attachment.storageKey))) {
      throw new ConflictError("The upload hasn't finished yet");
    }
    ready = (await ctx.store.attachments.markReady(attachment.id))!;
  }
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "signature_captured",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: { attachment_id: ready.id, signer_name: input.signer_name },
  });
  return { ...ready, caption: ready.caption ?? input.signer_name };
}
