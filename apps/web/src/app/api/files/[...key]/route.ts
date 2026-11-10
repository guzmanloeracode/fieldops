import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@fieldops/shared";
import {
  FILES_DIR,
  UNSIZED_UPLOAD_LIMIT,
  commitUpload,
  isValidKey,
  pathFor,
  readMeta,
  storageBackend,
  verifySignature,
} from "@/server/files";

// Local upload endpoint for presigned URLs (ADR 015). Only active when R2 isn't configured. Every request
// carries an HMAC signature over the method, key and limits that the server issued, so this route needs no
// session: the signature is the permission, and it expires after 10 minutes (PUT) or an hour (GET).

export const dynamic = "force-dynamic";

const ALLOWED: readonly string[] = [...ALLOWED_ATTACHMENT_TYPES];

function problem(status: number, title: string) {
  return Response.json(
    { type: "about:blank", title, status },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

async function keyFrom(params: Promise<{ key: string[] }>): Promise<string | null> {
  const key = (await params).key.join("/");
  return storageBackend === "local" && isValidKey(key) ? key : null;
}

const expired = (exp: number) => !Number.isFinite(exp) || exp < Date.now() / 1000;

export async function PUT(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = await keyFrom(params);
  if (!key) return problem(404, "Not found");
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const size = Number(url.searchParams.get("size") ?? "0");
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (expired(exp)) return problem(403, "The upload link has expired");
  if (!verifySignature(["PUT", key, contentType, size, exp], url.searchParams.get("sig"))) {
    return problem(403, "Invalid upload signature");
  }
  if (!ALLOWED.includes(contentType)) return problem(415, "This file type isn't allowed");
  if (!req.body) return problem(400, "Empty upload");

  const limit = size > 0 ? size : UNSIZED_UPLOAD_LIMIT;
  if (limit > MAX_ATTACHMENT_BYTES) return problem(413, "The file is too large");
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) return problem(413, "The file is too large");

  const tmpDir = join(FILES_DIR, ".tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmp = join(tmpDir, randomUUID());
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      done(received > limit ? new Error("too_large") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body as never), counter, createWriteStream(tmp));
  } catch (err) {
    await rm(tmp, { force: true });
    if (err instanceof Error && err.message === "too_large") return problem(413, "The file is too large");
    throw err;
  }
  if (size > 0 && received !== size) {
    await rm(tmp, { force: true });
    return problem(400, "The upload doesn't match the declared size");
  }
  await commitUpload(key, tmp, { contentType, size: received });
  return new Response(null, { status: 200 });
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = await keyFrom(params);
  if (!key) return problem(404, "Not found");
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const name = url.searchParams.get("name") ?? "";
  if (expired(exp) || !verifySignature(["GET", key, name, exp], url.searchParams.get("sig"))) {
    return problem(403, "The link has expired");
  }
  const meta = await readMeta(key);
  const path = pathFor(key);
  const info = await stat(path).catch(() => null);
  if (!meta || !info?.isFile()) return problem(404, "Not found");
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: {
      "Content-Type": meta.contentType,
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(name ? { "Content-Disposition": `inline; filename="${name}"` } : {}),
    },
  });
}
