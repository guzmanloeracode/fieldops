import type { ApiKeyRecord, ApiKeyRepo } from "@fieldops/core";
import type { ApiKeyScope } from "@fieldops/shared";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { apiKey, member, user } from "../schema";

// API keys (PLT-02). Tenant-scoped like every repository; looking a key up by its hash happens outside the
// tenant, in the SECURITY DEFINER function api_key_authenticate() (migration 0005).

export function apiKeyRepo(tx: Tx, orgId: string): ApiKeyRepo {
  const select = () =>
    tx
      .select({ k: apiKey, memberName: user.name })
      .from(apiKey)
      .innerJoin(member, eq(member.id, apiKey.memberId))
      .innerJoin(user, eq(user.id, member.userId));
  const map = (r: { k: typeof apiKey.$inferSelect; memberName: string }): ApiKeyRecord => ({
    id: r.k.id,
    memberId: r.k.memberId,
    memberName: r.memberName,
    name: r.k.name,
    prefix: r.k.prefix,
    scopes: r.k.scopes as ApiKeyScope[],
    createdAt: r.k.createdAt,
    lastUsedAt: r.k.lastUsedAt,
    expiresAt: r.k.expiresAt,
    revokedAt: r.k.revokedAt,
  });
  return {
    async list() {
      const rows = await select()
        .where(eq(apiKey.organizationId, orgId))
        .orderBy(desc(apiKey.createdAt), desc(apiKey.id));
      return rows.map(map);
    },
    async get(id) {
      const [r] = await select().where(and(eq(apiKey.organizationId, orgId), eq(apiKey.id, id)));
      return r ? map(r) : null;
    },
    async countActive(now) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(apiKey)
        .where(
          and(
            eq(apiKey.organizationId, orgId),
            isNull(apiKey.revokedAt),
            or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, now)),
          ),
        );
      return r?.n ?? 0;
    },
    async create(data) {
      const [r] = await tx
        .insert(apiKey)
        .values({ organizationId: orgId, ...data })
        .returning({ id: apiKey.id });
      return (await this.get(r!.id))!;
    },
    async revoke(id, now) {
      const rows = await tx
        .update(apiKey)
        .set({ revokedAt: now })
        .where(and(eq(apiKey.organizationId, orgId), eq(apiKey.id, id), isNull(apiKey.revokedAt)))
        .returning({ id: apiKey.id });
      return rows.length > 0;
    },
  };
}

/** What api_key_authenticate() returns for a valid key, or null. Runs outside any tenant transaction. */
export async function authenticateApiKey(
  db: { execute: Tx["execute"] },
  tokenHash: string,
): Promise<{
  keyId: string;
  organizationId: string;
  memberId: string;
  userId: string;
  scopes: ApiKeyScope[];
} | null> {
  const res = await db.execute(sql`select * from api_key_authenticate(${tokenHash})`);
  const row = (res.rows as Record<string, unknown>[])[0];
  if (!row) return null;
  return {
    keyId: String(row.key_id),
    organizationId: String(row.organization_id),
    memberId: String(row.member_id),
    userId: String(row.user_id),
    scopes: (row.scopes as string[]).filter((s): s is ApiKeyScope => s === "read" || s === "write"),
  };
}

/**
 * Counts one request in a fixed one-minute window (PLT-04) in a single statement, outside any tenant transaction:
 * rate_limit isn't tenant-scoped. Returns the count so far and when the window resets.
 */
export async function hitRateWindow(
  db: { execute: Tx["execute"] },
  key: string,
  windowSeconds: number,
  now: Date,
): Promise<{ count: number; resetAt: Date }> {
  const startMs = Math.floor(now.getTime() / 1000 / windowSeconds) * windowSeconds * 1000;
  const res = await db.execute(sql`
    insert into rate_limit (key, window_start, count) values (${key}, ${new Date(startMs).toISOString()}::timestamptz, 1)
    on conflict (key, window_start) do update set count = rate_limit.count + 1
    returning count`);
  const row = (res.rows as { count: number }[])[0]!;
  return { count: Number(row.count), resetAt: new Date(startMs + windowSeconds * 1000) };
}
