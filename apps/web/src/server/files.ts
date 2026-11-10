import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStorage } from "@fieldops/core";
import { env, r2Configured } from "@/env";

// Uploads use presigned URLs either way: the browser PUTs the file to a short-lived signed URL, then the
// server confirms it exists. With R2 configured the URLs point at R2; otherwise at /api/files on this app,
// which writes to a local directory (ADR 015). Services only see the FileStorage interface.

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

const r2: FileStorage = {
  async presignPut(key, contentType, sizeBytes) {
    const expiresIn = 600;
    const url = await getSignedUrl(
      s3(),
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ContentType: contentType,
        ...(sizeBytes ? { ContentLength: sizeBytes } : {}),
      }),
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
          ? { ResponseContentDisposition: `inline; filename="${safeHeaderName(opts.downloadName)}"` }
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
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  },
};

// ------------------------------------------------------------------ local disk (ADR 015)

export const FILES_DIR = resolve(
  env.FILES_DIR ?? (env.NODE_ENV === "production" ? "/data/files" : join(tmpdir(), "fieldops-files")),
);
/** Upper bound for an upload without a declared size (thumbnails, signatures). */
export const UNSIZED_UPLOAD_LIMIT = 2 * 1024 * 1024;
const PUT_TTL_S = 600;
const GET_TTL_S = 3600;

/** Storage keys the services create: org/<uuid>/<area>/<uuid>/<uuid>/<file name>. */
const KEY_PATTERN = /^org\/[0-9a-f-]{36}\/[a-z]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,160}$/;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.split("/").some((p) => p === "." || p === "..");
}

/** Absolute path of a key, guaranteed to stay inside FILES_DIR. */
export function pathFor(key: string): string {
  if (!isValidKey(key)) throw new Error("Invalid storage key");
  const p = resolve(FILES_DIR, key);
  if (!p.startsWith(FILES_DIR + sep)) throw new Error("Invalid storage key");
  return p;
}

function safeHeaderName(name: string): string {
  return name.replace(/[^\w.\- ]/g, "_");
}

function sign(parts: (string | number)[]): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(["fieldops-files", ...parts].join("\n"))
    .digest("base64url");
}

export function verifySignature(parts: (string | number)[], signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(sign(parts));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function fileUrl(key: string, params: Record<string, string>): string {
  const url = new URL(`/api/files/${key}`, env.APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export interface StoredMeta {
  contentType: string;
  size: number;
}

export async function readMeta(key: string): Promise<StoredMeta | null> {
  try {
    return JSON.parse(await readFile(`${pathFor(key)}.meta.json`, "utf8")) as StoredMeta;
  } catch {
    return null;
  }
}

/** Moves a finished upload into place and records its content type. */
export async function commitUpload(key: string, tmpPath: string, meta: StoredMeta): Promise<void> {
  const target = pathFor(key);
  await mkdir(dirname(target), { recursive: true });
  await rename(tmpPath, target);
  await writeFile(`${target}.meta.json`, JSON.stringify(meta));
}

const local: FileStorage = {
  async presignPut(key, contentType, sizeBytes) {
    const exp = Math.floor(Date.now() / 1000) + PUT_TTL_S;
    const size = sizeBytes ?? 0;
    const sig = sign(["PUT", key, contentType, size, exp]);
    return {
      url: fileUrl(key, { exp: String(exp), size: String(size), sig }),
      headers: { "Content-Type": contentType },
      expiresIn: PUT_TTL_S,
    };
  },
  async presignGet(key, opts) {
    const exp = Math.floor(Date.now() / 1000) + GET_TTL_S;
    const name = opts?.downloadName ? safeHeaderName(opts.downloadName) : "";
    const sig = sign(["GET", key, name, exp]);
    return fileUrl(key, { exp: String(exp), ...(name ? { name } : {}), sig });
  },
  async exists(key) {
    try {
      return (await stat(pathFor(key))).isFile();
    } catch {
      return false;
    }
  },
  async remove(keys) {
    await Promise.all(
      keys
        .filter(isValidKey)
        .flatMap((k) => [rm(pathFor(k), { force: true }), rm(`${pathFor(k)}.meta.json`, { force: true })]),
    );
  },
};

export const storageBackend: "r2" | "local" = r2Configured ? "r2" : "local";
export const files: FileStorage = r2Configured ? r2 : local;
