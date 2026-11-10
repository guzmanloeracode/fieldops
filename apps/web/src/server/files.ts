import "server-only";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStorage } from "@fieldops/core";
import { env, fileStorageConfigured } from "@/env";

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
  return client;
}

/** Cloudflare R2 (S3 API) with presigned uploads and downloads. Files never pass through the web server. */
export const files: FileStorage | undefined = fileStorageConfigured
  ? {
      async presignPut(key, contentType, sizeBytes) {
        const expiresIn = 600;
        const url = await getSignedUrl(
          s3(),
          new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType, ...(sizeBytes ? { ContentLength: sizeBytes } : {}) }),
          { expiresIn, signableHeaders: new Set(["content-type"]) },
        );
        return { url, headers: { "Content-Type": contentType }, expiresIn };
      },
      async presignGet(key, opts) {
        return getSignedUrl(
          s3(),
          new GetObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            ...(opts?.downloadName
              ? { ResponseContentDisposition: `inline; filename="${opts.downloadName.replace(/[^\w.\- ]/g, "_")}"` }
              : {}),
          }),
          { expiresIn: 3600 },
        );
      },
      async exists(key) {
        try {
          await s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
          return true;
        } catch {
          return false;
        }
      },
      async remove(keys) {
        if (!keys.length) return;
        await s3().send(
          new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
        );
      },
    }
  : undefined;
