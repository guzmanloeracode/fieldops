"use client";
import type { AttachmentKind, AttachmentTag } from "@fieldops/shared";
import { confirmUploadAction, requestUploadAction } from "../actions";

/** Resizes an image in the browser to a small WebP thumbnail, so the server never processes images. */
export async function makeThumbnail(file: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", 0.8));
  } catch {
    return null;
  }
}

export type UploadResult = { ok: true; attachmentId: string } | { ok: false; message: string };

/**
 * Uploads a file through a presigned URL (JOB-06). With `confirm: false` the attachment stays pending, for
 * uploads another service links and confirms (signatures).
 */
export async function uploadToJob(
  jobId: string,
  file: Blob,
  opts: {
    fileName: string;
    kind: AttachmentKind;
    tag?: AttachmentTag | null;
    caption?: string | null;
    confirm?: boolean;
    failedMessage: string;
  },
): Promise<UploadResult> {
  const isImage = file.type.startsWith("image/");
  const thumb = isImage && opts.kind === "photo" ? await makeThumbnail(file) : null;
  const req = await requestUploadAction(jobId, {
    file_name: opts.fileName,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    kind: opts.kind,
    tag: opts.tag ?? null,
    caption: opts.caption ?? null,
    with_thumbnail: Boolean(thumb),
  });
  if (!req.ok) return { ok: false, message: req.error.fields?.[0]?.message ?? req.error.message };
  const put = await fetch(req.data.uploadUrl, { method: "PUT", body: file, headers: req.data.headers });
  if (!put.ok) return { ok: false, message: opts.failedMessage };
  if (thumb && req.data.thumbnailUploadUrl) {
    await fetch(req.data.thumbnailUploadUrl, {
      method: "PUT",
      body: thumb,
      headers: { "Content-Type": "image/webp" },
    });
  }
  if (opts.confirm !== false) {
    const confirmed = await confirmUploadAction(req.data.attachmentId);
    if (!confirmed.ok) return { ok: false, message: confirmed.error.message };
  }
  return { ok: true, attachmentId: req.data.attachmentId };
}
