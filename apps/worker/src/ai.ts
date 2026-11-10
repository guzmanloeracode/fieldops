import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createIntakeModel } from "@fieldops/ai";
import { ai, type AttachmentRecord, type IntakeModel, type IntakePhoto } from "@fieldops/core";
import { claimPendingAiDrafts, failAiDraft, withStore, type Database } from "@fieldops/db";
import { AI_IMAGE_TYPES, type AiImageType } from "@fieldops/shared";
import { env } from "./env";
import { log } from "./log";

// AI drafts for portal requests (AI-01). The portal creates the job with ai_status "pending"; this loop claims
// a few at a time (packages/db ai-queue.ts) and drafts each one with the core service.

export const intakeModel: IntakeModel = createIntakeModel({
  apiKey: env.ai.apiKey,
  provider: env.ai.provider,
  intakeModel: env.ai.intakeModel,
});

// ------------------------------------------------------------------ photos

/** Claude reads JPEG, PNG and WebP up to about 5 MB; larger or other photos use their WebP thumbnail. */
const MAX_PHOTO_BYTES = 3_500_000;

let s3: S3Client | null = null;
export async function readObject(key: string): Promise<Buffer> {
  const { endpoint, bucket, accessKeyId, secretAccessKey, region } = env.s3;
  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    s3 ??= new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }
  if (!env.filesDir || !key.startsWith("org/") || key.split("/").includes(".."))
    throw new Error("No file storage");
  const root = resolve(env.filesDir);
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error("Invalid storage key");
  return readFile(path);
}

export async function loadPhotos(attachments: AttachmentRecord[]): Promise<IntakePhoto[]> {
  const photos: IntakePhoto[] = [];
  for (const a of attachments) {
    const original =
      (AI_IMAGE_TYPES as readonly string[]).includes(a.mimeType) && a.sizeBytes <= MAX_PHOTO_BYTES;
    const key = original ? a.storageKey : a.thumbKey;
    if (!key) continue;
    try {
      const bytes = await readObject(key);
      photos.push({
        mediaType: (original ? a.mimeType : "image/webp") as AiImageType,
        data: bytes.toString("base64"),
      });
    } catch (err) {
      log.warn({ err, attachmentId: a.id }, "portal photo unreadable; drafting without it");
    }
  }
  return photos;
}

/** Drafts what is pending. Returns how many requests it handled. */
export async function draftPending(db: Database, model = intakeModel): Promise<number> {
  const claimed = await claimPendingAiDrafts(db);
  for (const job of claimed) {
    const status = await ai
      .draftPortalJob(
        (fn) => withStore(db, job.organizationId, (store) => fn(store)),
        model,
        job.id,
        loadPhotos,
        new Date(),
      )
      .catch(async (err) => {
        log.error({ err, jobId: job.id }, "portal draft failed");
        await failAiDraft(db, job.id);
        return "failed" as const;
      });
    log.info({ jobId: job.id, orgId: job.organizationId, status }, "portal request drafted");
  }
  return claimed.length;
}
