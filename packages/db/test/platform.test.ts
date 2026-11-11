import { apiKeys, type Actor } from "@fieldops/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticateApiKey, hitRateWindow } from "../src/repos/api-keys";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, pgErrorOf, type OrgData, type TestDb, freshDatabase } from "./helpers";

// API keys (PLT-02) and the rate-limit window (PLT-04) against PostgreSQL with row-level security: keys are
// created through the real service as the web role, and looked up by hash outside any tenant.

let t: TestDb;
let a: OrgData;
let b: OrgData;
const NOW = new Date("2026-11-11T16:30:00Z");

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "keys");
  b = await createOrgWithData(t.owner, "other");
});
afterAll(async () => t?.close());

const owner = (org: OrgData): Actor => ({
  userId: org.users.owner,
  memberId: org.members.owner,
  organizationId: org.orgId,
  role: "owner",
  name: "owner",
});

const create = (org: OrgData, input: Record<string, unknown>, now = NOW) =>
  withStore(t.app, org.orgId, (store) =>
    apiKeys.createApiKey({ actor: owner(org), store, now, demo: false }, input),
  );

describe("api keys", () => {
  it("authenticates a key by its hash and returns its organization, member and scopes", async () => {
    const { key, record } = await create(a, { name: "BI", scopes: ["read"] });
    const found = await authenticateApiKey(t.app, await apiKeys.hashApiKey(key));
    expect(found).toEqual({
      keyId: record.id,
      organizationId: a.orgId,
      memberId: a.members.owner,
      userId: a.users.owner,
      scopes: ["read"],
    });
    expect(await authenticateApiKey(t.app, await apiKeys.hashApiKey(`${key.slice(0, -1)}x`))).toBeNull();
  });

  it("records the last use at most once a minute", async () => {
    const { key, record } = await create(a, { name: "Sync", scopes: ["write"] });
    const hash = await apiKeys.hashApiKey(key);
    await authenticateApiKey(t.app, hash);
    const first = await t.owner.select().from(s.apiKey).where(eq(s.apiKey.id, record.id));
    expect(first[0]!.lastUsedAt).not.toBeNull();
    await authenticateApiKey(t.app, hash);
    const second = await t.owner.select().from(s.apiKey).where(eq(s.apiKey.id, record.id));
    expect(second[0]!.lastUsedAt).toEqual(first[0]!.lastUsedAt);
    // A minute later it moves.
    await t.owner
      .update(s.apiKey)
      .set({ lastUsedAt: new Date(Date.now() - 120_000) })
      .where(eq(s.apiKey.id, record.id));
    await authenticateApiKey(t.app, hash);
    const third = await t.owner.select().from(s.apiKey).where(eq(s.apiKey.id, record.id));
    expect(third[0]!.lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("refuses revoked and expired keys", async () => {
    const revoked = await create(a, { name: "Old", scopes: ["read"] });
    await withStore(t.app, a.orgId, (store) =>
      apiKeys.revokeApiKey({ actor: owner(a), store, now: NOW, demo: false }, revoked.record.id),
    );
    expect(await authenticateApiKey(t.app, await apiKeys.hashApiKey(revoked.key))).toBeNull();

    const expiring = await create(a, { name: "Short", scopes: ["read"], expires_in_days: 30 });
    expect(await authenticateApiKey(t.app, await apiKeys.hashApiKey(expiring.key))).not.toBeNull();
    await t.owner
      .update(s.apiKey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.apiKey.id, expiring.record.id));
    expect(await authenticateApiKey(t.app, await apiKeys.hashApiKey(expiring.key))).toBeNull();
  });

  it("stops working when the member who created it is removed", async () => {
    const { key } = await withStore(t.app, b.orgId, (store) =>
      apiKeys.createApiKey(
        {
          actor: { ...owner(b), userId: b.users.dispatcher, memberId: b.members.dispatcher, role: "admin" },
          store,
          now: NOW,
          demo: false,
        },
        { name: "Leaver", scopes: ["read"] },
      ),
    );
    const hash = await apiKeys.hashApiKey(key);
    expect((await authenticateApiKey(t.app, hash))?.organizationId).toBe(b.orgId);
    await t.owner.delete(s.member).where(eq(s.member.id, b.members.dispatcher));
    expect(await authenticateApiKey(t.app, hash)).toBeNull();
  });

  it("keeps keys to their organization", async () => {
    await create(b, { name: "Theirs", scopes: ["read"] });
    const mine = await withStore(t.app, a.orgId, (store) => store.apiKeys.list());
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((k) => k.name !== "Theirs")).toBe(true);
    // The hash and the secret never come back from the repository.
    expect(JSON.stringify(mine)).not.toMatch(/token|hash/i);
    // Revoking another organization's key finds nothing.
    const theirs = await t.owner.select().from(s.apiKey).where(eq(s.apiKey.organizationId, b.orgId));
    await expect(
      withStore(t.app, a.orgId, (store) =>
        apiKeys.revokeApiKey({ actor: owner(a), store, now: NOW, demo: false }, theirs[0]!.id),
      ),
    ).rejects.toThrow(/not found/);
  });

  it("can't be read or inserted for another organization by the web role", async () => {
    expect(
      await pgErrorOf(
        withStore(t.app, a.orgId, (_store, tx) =>
          tx.insert(s.apiKey).values({
            organizationId: b.orgId,
            memberId: b.members.owner,
            name: "Sneaky",
            prefix: "fo_sneak",
            tokenHash: "sneaky",
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    const direct = await t.app.execute(sql`select 1 from api_key`);
    expect(direct.rows).toHaveLength(0);
  });
});

describe("rate-limit window", () => {
  it("counts requests per key and window in one statement, as the web role", async () => {
    const at = new Date("2026-11-11T16:30:10Z");
    const one = await hitRateWindow(t.app, "api:key:test", 60, at);
    const two = await hitRateWindow(t.app, "api:key:test", 60, new Date("2026-11-11T16:30:59Z"));
    expect(one).toEqual({ count: 1, resetAt: new Date("2026-11-11T16:31:00Z") });
    expect(two.count).toBe(2);
    const next = await hitRateWindow(t.app, "api:key:test", 60, new Date("2026-11-11T16:31:00Z"));
    expect(next).toEqual({ count: 1, resetAt: new Date("2026-11-11T16:32:00Z") });
    expect((await hitRateWindow(t.app, "api:user:other", 60, at)).count).toBe(1);
  });
});
