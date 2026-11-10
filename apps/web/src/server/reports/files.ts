import "server-only";
import { readFile } from "node:fs/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AttachmentRecord, IntakePhoto } from "@fieldops/core";
import { AI_IMAGE_TYPES, type AiImageType } from "@fieldops/shared";
import { env, r2Configured } from "@/env";
import { pathFor } from "@/server/files";
import { logger } from "@/server/logger";

// Reading stored images on the server for service reports: the PDF embeds photos and the signature, and the
// report writer looks at small before and after photos. Uploads themselves never pass through the server.

let client: S3Client | null = null;

/** The bytes of a stored file, from R2 or the local upload directory (ADR 015). */
export async function readStoredFile(key: string): Promise<Uint8Array> {
  if (r2Configured) {
    client ??= new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    });
    const out = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return out.Body!.transformToByteArray();
  }
  return new Uint8Array(await readFile(pathFor(key)));
}

/** JPEG and PNG originals the PDF can embed as they are; larger ones would make the PDF too heavy. */
const PDF_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_PDF_IMAGE_BYTES = 4_000_000;

/** An image for the PDF, or null when it can't be embedded (other formats, too large, unreadable). */
export async function pdfImage(a: AttachmentRecord | null): Promise<Uint8Array | null> {
  if (!a || !PDF_IMAGE_TYPES.has(a.mimeType) || a.sizeBytes > MAX_PDF_IMAGE_BYTES) return null;
  try {
    return await readStoredFile(a.storageKey);
  } catch (err) {
    logger.warn({ err, attachmentId: a.id }, "report image unreadable; leaving it out of the PDF");
    return null;
  }
}

const MAX_AI_PHOTO_BYTES = 3_500_000;

/** Small photos for the report writer: the WebP thumbnail, or a small original when there is none. */
export async function loadReportPhotos(attachments: AttachmentRecord[]): Promise<IntakePhoto[]> {
  const photos: IntakePhoto[] = [];
  for (const a of attachments) {
    const original =
      (AI_IMAGE_TYPES as readonly string[]).includes(a.mimeType) && a.sizeBytes <= MAX_AI_PHOTO_BYTES;
    const key = a.thumbKey ?? (original ? a.storageKey : null);
    if (!key) continue;
    try {
      const bytes = await readStoredFile(key);
      photos.push({
        mediaType: (a.thumbKey ? "image/webp" : a.mimeType) as AiImageType,
        data: Buffer.from(bytes).toString("base64"),
      });
    } catch (err) {
      logger.warn({ err, attachmentId: a.id }, "report photo unreadable; drafting without it");
    }
  }
  return photos;
}
