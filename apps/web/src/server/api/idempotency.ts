import "server-only";
import { schema, type Tx } from "@fieldops/db";
import { and, eq, sql } from "drizzle-orm";
import { ApiProblem } from "./problem";

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export interface IdempotencyScope {
  organizationId: string;
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
}

export async function hashBody(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(digest).toString("hex");
}

export function readIdempotencyKey(req: Request): string | null {
  const key = req.headers.get("idempotency-key");
  if (key === null) return null;
  if (!KEY_PATTERN.test(key)) {
    throw new ApiProblem(400, "bad_request", "Idempotency-Key must be 1–255 visible ASCII characters");
  }
  return key;
}

/**
 * Claims an Idempotency-Key inside the request's transaction (PRD §17.1). A placeholder row is inserted
 * first; a concurrent request with the same key blocks on the unique index until this transaction ends,
 * then sees the stored response. Keys older than 24 hours are reused as new.
 * Returns the stored response to replay, or null when the request should run.
 */
export async function claimIdempotencyKey(
  tx: Tx,
  s: IdempotencyScope,
): Promise<{ status: number; body: unknown } | null> {
  const t = schema.idempotencyKey;
  const placeholder = {
    organizationId: s.organizationId,
    key: s.key,
    userId: s.userId,
    method: s.method,
    path: s.path,
    requestHash: s.requestHash,
    responseStatus: 0,
    responseBody: null,
    createdAt: new Date(),
  };
  const claimed = await tx
    .insert(t)
    .values(placeholder)
    .onConflictDoUpdate({
      target: [t.organizationId, t.key],
      set: placeholder,
      setWhere: sql`${t.createdAt} < now() - interval '24 hours'`,
    })
    .returning({ key: t.key });
  if (claimed.length) return null;

  const [existing] = await tx
    .select()
    .from(t)
    .where(and(eq(t.organizationId, s.organizationId), eq(t.key, s.key)));
  if (!existing) return null;
  if (
    existing.userId !== s.userId ||
    existing.method !== s.method ||
    existing.path !== s.path ||
    existing.requestHash !== s.requestHash
  ) {
    throw new ApiProblem(
      422,
      "idempotency_mismatch",
      "This Idempotency-Key was already used with a different request",
    );
  }
  if (existing.responseStatus === 0) {
    throw new ApiProblem(
      409,
      "idempotency_in_progress",
      "A request with this Idempotency-Key is still being processed",
    );
  }
  return { status: existing.responseStatus, body: existing.responseBody };
}

export async function storeIdempotentResponse(
  tx: Tx,
  s: Pick<IdempotencyScope, "organizationId" | "key">,
  status: number,
  body: unknown,
) {
  const t = schema.idempotencyKey;
  await tx
    .update(t)
    .set({ responseStatus: status, responseBody: body ?? null })
    .where(and(eq(t.organizationId, s.organizationId), eq(t.key, s.key)));
}
