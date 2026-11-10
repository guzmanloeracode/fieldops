import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimPendingAiDrafts, failAiDraft, releaseStuckAiDrafts } from "../src/ai-queue";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// AI usage log, drafts and rate limits (AI-01, §9.7, PLT-04) against PostgreSQL, as the RLS role.

let t: TestDb;
let a: OrgData;
let b: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
});
afterAll(async () => t?.close());

const row = (extra: Record<string, unknown> = {}) => ({
  userId: null,
  jobId: null,
  feature: "intake" as const,
  model: "claude-opus-5-5",
  inputTokens: 2000,
  outputTokens: 400,
  cacheReadTokens: 1500,
  cacheWriteTokens: 0,
  latencyMs: 3000,
  stopReason: "end_turn",
  outcome: "drafted" as const,
  output: { title: "x" },
  error: null,
  ...extra,
});

describe("ai repository", () => {
  it("logs calls, decides an outcome once and summarizes usage", async () => {
    const since = new Date(Date.now() - 60_000);
    const id = await withStore(t.app, a.orgId, async (store) => {
      const { id } = await store.ai.logInteraction(row({ userId: a.users.dispatcher }));
      await store.ai.logInteraction(
        row({ outcome: "failed", output: null, error: "overloaded", latencyMs: 1000 }),
      );
      return id;
    });
    await withStore(t.app, a.orgId, async (store) => {
      expect(await store.ai.getInteraction(id)).toMatchObject({
        id,
        userId: a.users.dispatcher,
        outcome: "drafted",
      });
      expect(await store.ai.setOutcome(id, "accepted", a.ids.job)).toBe(true);
      expect(await store.ai.setOutcome(id, "edited")).toBe(false);
      expect(await store.ai.getInteraction(id)).toMatchObject({ outcome: "accepted", jobId: a.ids.job });
      const usage = await store.ai.usageSince(since);
      expect(usage.outcomes).toMatchObject({ accepted: 2, failed: 1 });
      expect(usage.calls).toBe(3);
      expect(await store.ai.countSince(since)).toBe(3);
      expect(await store.ai.countSince(new Date(Date.now() + 60_000))).toBe(0);
    });
    // Another organization sees none of it.
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.ai.getInteraction(id)).toBeNull();
      expect(await store.ai.setOutcome(id, "discarded")).toBe(false);
      expect((await store.ai.usageSince(since)).calls).toBe(1);
    });
  });

  it("finds a job's latest draft and sets the drafting status without a version bump", async () => {
    await withStore(t.app, a.orgId, async (store) => {
      await store.ai.logInteraction(row({ jobId: a.ids.job, output: { title: "first" } }));
      await store.ai.logInteraction(row({ jobId: a.ids.job, output: { title: "second" } }));
      await store.ai.logInteraction(row({ jobId: a.ids.job, output: null, outcome: "failed" }));
      expect((await store.ai.latestDraft(a.ids.job))?.output).toEqual({ title: "second" });
      expect(await store.ai.latestDraft(b.ids.job)).toBeNull();
      const before = await store.jobs.get(a.ids.job);
      await store.ai.setJobStatus(a.ids.job, "drafted");
      await store.ai.setJobStatus(b.ids.job, "drafted");
      const after = await store.jobs.get(a.ids.job);
      expect(after?.aiStatus).toBe("drafted");
      expect(after?.version).toBe(before?.version);
    });
    const other = await t.owner.execute<{ ai_status: string | null }>(
      sql`select ai_status from job where id = ${b.ids.job}`,
    );
    expect(other.rows[0]!.ai_status).toBeNull();
  });

  it("counts rate-limit hits per key and window, atomically", async () => {
    const now = new Date("2026-11-10T09:30:00Z");
    const hit = () => withStore(t.app, a.orgId, (store) => store.ai.hitRateLimit("ai:user:x", 3600, now));
    const results = await Promise.all(Array.from({ length: 8 }, hit));
    expect(results.map((r) => r.count).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(results[0]!.resetAt.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    // The next window starts again, and another key is separate. Keys are shared across organizations.
    const next = await withStore(t.app, b.orgId, (store) =>
      store.ai.hitRateLimit("ai:user:x", 3600, new Date("2026-11-10T10:00:00Z")),
    );
    expect(next.count).toBe(1);
    const global = await withStore(t.app, b.orgId, (store) => store.ai.hitRateLimit("ai:global", 86400, now));
    expect(global).toEqual({ count: 1, resetAt: new Date("2026-11-11T00:00:00Z") });
  });
});

describe("needs_review filter", () => {
  it("lists only jobs waiting for review", async () => {
    await t.owner.execute(sql`update job set needs_review = true where id = ${a.ids.job}`);
    await withStore(t.app, a.orgId, async (store) => {
      const page = await store.jobs.list({ sort: "-created_at", limit: 50, needs_review: true, page: 1 });
      expect(page.rows.map((j) => j.id)).toEqual([a.ids.job]);
      await t.owner.execute(sql`update job set needs_review = false where id = ${a.ids.job}`);
    });
    await withStore(t.app, a.orgId, async (store) => {
      const page = await store.jobs.list({ sort: "-created_at", limit: 50, needs_review: true, page: 1 });
      expect(page.total).toBe(0);
    });
  });
});

describe("AI draft queue", () => {
  it("claims pending portal requests once, across organizations, and releases stuck claims", async () => {
    await t.owner.execute(sql`update job set ai_status = 'pending' where id in (${a.ids.job}, ${b.ids.job})`);
    const [first, second] = await Promise.all([
      claimPendingAiDrafts(t.owner, 5),
      claimPendingAiDrafts(t.owner, 5),
    ]);
    const claimed = [...first!, ...second!];
    expect(claimed.map((c) => c.id).sort()).toEqual([a.ids.job, b.ids.job].sort());
    expect(claimed.find((c) => c.id === a.ids.job)?.organizationId).toBe(a.orgId);
    expect(await claimPendingAiDrafts(t.owner)).toEqual([]);

    expect(await releaseStuckAiDrafts(t.owner)).toBe(0);
    await t.owner.execute(
      sql`update job set updated_at = now() - interval '11 minutes' where id = ${a.ids.job}`,
    );
    expect(await releaseStuckAiDrafts(t.owner)).toBe(1);
    await failAiDraft(t.owner, b.ids.job);
    await failAiDraft(t.owner, a.ids.job); // pending again: not touched
    const rows = await t.owner.execute<{ id: string; ai_status: string }>(
      sql`select id, ai_status from job where id in (${a.ids.job}, ${b.ids.job})`,
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.id, r.ai_status]))).toEqual({
      [a.ids.job]: "pending",
      [b.ids.job]: "failed",
    });
  });
});
