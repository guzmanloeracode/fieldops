import {
  API_KEY_PATTERN,
  API_KEY_PREFIX,
  API_KEY_VISIBLE_CHARS,
  MAX_API_KEYS_PER_ORG,
  apiKeyCreateSchema,
  type ApiKeyScope,
} from "@fieldops/shared";
import { NotFoundError, ValidationError } from "../domain/errors";
import { assertCan } from "../domain/permissions";
import type { ApiKeyRecord } from "./api-key-types";
import type { ServiceContext } from "./types";
import { parseInput } from "./validate";

// API keys (PLT-02, ADR 023). A key acts as the member who created it, within that member's role; its scopes only
// narrow what the member could do. Keys are shown once: the database keeps the SHA-256 hash and the first seven
// characters. Managing keys needs a signed-in owner or admin, never another key.

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SECRET_LENGTH = 40;

/** 40 base62 characters from the platform CSPRNG, without modulo bias (bytes ≥ 248 are drawn again). */
function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < 248 && out.length < length) out += BASE62[b % 62];
    }
  }
  return out;
}

/** The SHA-256 of the whole key, in lowercase hex: what api_key.token_hash stores. */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new key: `fo_` + 40 base62 characters, the characters lists show, and the hash to store. */
export async function generateApiKey(): Promise<{ key: string; prefix: string; hash: string }> {
  const key = `${API_KEY_PREFIX}${randomBase62(SECRET_LENGTH)}`;
  return { key, prefix: key.slice(0, API_KEY_VISIBLE_CHARS), hash: await hashApiKey(key) };
}

export const looksLikeApiKey = (value: string) => API_KEY_PATTERN.test(value);

/** The scope a request needs: reading methods need `read`, everything else `write`. */
export function scopeForMethod(method: string): ApiKeyScope {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS" ? "read" : "write";
}

/** `write` implies `read`. */
export function hasScope(scopes: readonly ApiKeyScope[], needed: ApiKeyScope): boolean {
  return scopes.includes(needed) || (needed === "read" && scopes.includes("write"));
}

export type ApiKeyState = "active" | "expired" | "revoked";

export function apiKeyState(key: Pick<ApiKeyRecord, "revokedAt" | "expiresAt">, now: Date): ApiKeyState {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export async function listApiKeys(ctx: ServiceContext): Promise<ApiKeyRecord[]> {
  assertCan(ctx.actor, "apiKeys.manage");
  return ctx.store.apiKeys.list();
}

/** Creates a key for the signed-in member. The returned `key` is the only time the secret exists in clear. */
export async function createApiKey(
  ctx: ServiceContext,
  raw: unknown,
): Promise<{ record: ApiKeyRecord; key: string }> {
  assertCan(ctx.actor, "apiKeys.manage");
  const input = parseInput(apiKeyCreateSchema, raw);
  if ((await ctx.store.apiKeys.countActive(ctx.now)) >= MAX_API_KEYS_PER_ORG) {
    throw new ValidationError(`An organization can have up to ${MAX_API_KEYS_PER_ORG} active keys`, [
      { path: "name", message: "Revoke a key you no longer use first" },
    ]);
  }
  const { key, prefix, hash } = await generateApiKey();
  const days = input.expires_in_days ?? null;
  const record = await ctx.store.apiKeys.create({
    memberId: ctx.actor.memberId,
    name: input.name,
    prefix,
    tokenHash: hash,
    // `write` alone also reads, but storing both keeps the list honest about what the key can do.
    scopes: input.scopes.includes("write") ? ["read", "write"] : ["read"],
    expiresAt: days ? new Date(ctx.now.getTime() + days * 86_400_000) : null,
  });
  return { record, key };
}

/** Revokes a key at once. Revoking a revoked key changes nothing and isn't an error. */
export async function revokeApiKey(ctx: ServiceContext, id: string): Promise<ApiKeyRecord> {
  assertCan(ctx.actor, "apiKeys.manage");
  const key = await ctx.store.apiKeys.get(id);
  if (!key) throw new NotFoundError("API key");
  await ctx.store.apiKeys.revoke(id, ctx.now);
  return (await ctx.store.apiKeys.get(id))!;
}
