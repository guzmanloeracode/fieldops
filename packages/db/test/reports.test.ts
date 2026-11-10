import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { claimPendingReports, failReportDraft, releaseStuckReports } from "../src/repos/reports";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Service reports (AI-03) against PostgreSQL, as the RLS role; the worker's queue as the owner.

let t: TestDb;
let a: OrgData;
let b: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
});
afterAll(async () => t?.close());

const report = (jobId: string) => ({
  jobId,
  status: "draft" as const,
  locale: "id" as const,
  workPerformed: "Cuci AC",
  findings: null,
  recommendations: null,
  nextServiceDate: "2027-05-10",
  aiStatus: "pending" as const,
  aiInteractionId: null,
  aiDrafted: false,
  editedBy: null,
  sentAt: null,
  sentTo: null,
  sentBy: null,
});

/** Another completed job in the organization, for a second report. */
async function completedJob(org: OrgData, number: number) {
  const [j] = await t.owner
    .insert(s.job)
    .values({
      organizationId: org.orgId,
      number,
      customerId: org.ids.customer,
      siteId: org.ids.site,
      title: `Job ${number}`,
      status: "completed",
      completedAt: new Date("2026-11-10T10:00:00Z"),
    })
    .returning({ id: s.job.id });
  return j!.id;
}

describe("report repository", () => {
  it("keeps one report per job, versioned, and hides other organizations' reports", async () => {
    const jobId = await completedJob(a, 50);
    await withStore(t.app, a.orgId, async (store) => {
      const created = await store.reports.create(report(jobId));
      expect(created).toMatchObject({ jobId, version: 1, locale: "id", nextServiceDate: "2027-05-10" });
      expect(await store.reports.create(report(jobId))).toBeNull();
      expect((await store.reports.get(created!.id))!.workPerformed).toBe("Cuci AC");
      const updated = await store.reports.update(
        created!.id,
        { workPerformed: "Cuci 2 unit AC", editedBy: a.users.tech },
        1,
      );
      expect(updated).toMatchObject({ version: 2, workPerformed: "Cuci 2 unit AC", editedBy: a.users.tech });
      expect(await store.reports.update(created!.id, { findings: "x" }, 1)).toBeNull();
      expect(await store.reports.setAiStatus(created!.id, "drafted", "drafting")).toBe(false);
      expect(await store.reports.setAiStatus(created!.id, "drafting")).toBe(true);
      expect(await store.reports.setAiStatus(created!.id, "drafted", "drafting")).toBe(true);
      expect(await store.reports.getByJob(jobId)).toMatchObject({ aiStatus: "drafted", version: 2 });
    });
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.reports.getByJob(jobId)).toBeNull();
      expect(await store.reports.getByJob(a.ids.job)).toBeNull();
      expect(await store.reports.update(a.ids.job, { findings: "x" })).toBeNull();
      expect(await store.reports.setAiStatus(a.ids.job, "failed")).toBe(false);
      expect((await store.reports.getByJob(b.ids.job))!.workPerformed).toBe("Cleaned coils");
    });
  });

  it("claims pending reports once, releases stuck claims and marks crashes failed", async () => {
    const one = await completedJob(a, 60);
    const two = await completedJob(b, 61);
    const ids = await Promise.all([
      withStore(t.app, a.orgId, (store) => store.reports.create(report(one))),
      withStore(t.app, b.orgId, (store) => store.reports.create(report(two))),
    ]);
    const claims = await Promise.all([claimPendingReports(t.owner, 5), claimPendingReports(t.owner, 5)]);
    const claimed = claims.flat().filter((c) => c.jobId === one || c.jobId === two);
    expect(claimed.map((c) => c.jobId).sort()).toEqual([one, two].sort());
    expect(claimed.find((c) => c.jobId === one)!.organizationId).toBe(a.orgId);
    expect(await claimPendingReports(t.owner)).toEqual([]);
    expect(await releaseStuckReports(t.owner, 10)).toBe(0);
    await t.owner.execute(
      sql`update service_report set updated_at = now() - interval '11 minutes' where id = ${ids[0]!.id}`,
    );
    expect(await releaseStuckReports(t.owner, 10)).toBe(1);
    expect((await claimPendingReports(t.owner)).map((c) => c.id)).toEqual([ids[0]!.id]);
    await failReportDraft(t.owner, ids[0]!.id);
    await failReportDraft(t.owner, ids[1]!.id);
    const r = await t.owner.execute<{ id: string; ai_status: string }>(
      sql`select id, ai_status from service_report where id in (${ids[0]!.id}, ${ids[1]!.id})`,
    );
    expect(Object.fromEntries(r.rows.map((x) => [x.id, x.ai_status]))).toEqual({
      [ids[0]!.id]: "failed",
      [ids[1]!.id]: "failed",
    });
  });
});
