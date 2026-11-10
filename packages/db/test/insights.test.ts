import type { ReportFilters, Store } from "@fieldops/core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// 0.2 insights repositories against PostgreSQL: exact dashboard numbers on a small fixture (DSH-01 – DSH-04),
// saved views (JOB-04), search (JOB-11) and equipment history (CUS-03).

let t: TestDb;
let k: OrgData; // KPI fixture (America/Chicago)
let r: OrgData; // risk, approvals, search
const TZ = "America/Chicago";
const at = (iso: string) => new Date(iso);
const runIn = <T>(org: OrgData, fn: (store: Store) => Promise<T>) => withStore(t.app, org.orgId, fn);

async function job(org: OrgData, values: Partial<typeof s.job.$inferInsert> & { assign?: string }) {
  const id = randomUUID();
  const { assign, ...rest } = values;
  const [{ max }] = (
    await t.owner.execute<{ max: number }>(
      `select coalesce(max(number), 0)::int as max from job where organization_id = '${org.orgId}'`,
    )
  ).rows as [{ max: number }];
  await t.owner.insert(s.job).values({
    id,
    organizationId: org.orgId,
    number: max + 1,
    customerId: org.ids.customer,
    siteId: org.ids.site,
    title: `Fixture ${max + 1}`,
    ...rest,
  });
  if (assign) {
    await t.owner
      .insert(s.jobAssignment)
      .values({ organizationId: org.orgId, jobId: id, memberId: assign, isLead: true });
  }
  return id;
}

beforeAll(async () => {
  t = await freshDatabase();
  k = await createOrgWithData(t.owner, "k");
  r = await createOrgWithData(t.owner, "r");
  const st = k.ids.serviceType;
  // In range 2026-01-05 … 2026-01-11 (Chicago, UTC−6).
  await job(k, {
    priority: "urgent",
    status: "completed",
    serviceTypeId: st,
    createdAt: at("2026-01-05T15:00:00Z"),
    firstScheduledAt: at("2026-01-05T16:00:00Z"),
    scheduledStart: at("2026-01-05T17:00:00Z"),
    scheduledEnd: at("2026-01-05T19:00:00Z"),
    completedAt: at("2026-01-05T20:00:00Z"),
    assign: k.members.tech,
  });
  await job(k, {
    priority: "urgent",
    status: "completed",
    revisit: true,
    createdAt: at("2026-01-06T15:00:00Z"),
    firstScheduledAt: at("2026-01-06T18:00:00Z"),
    scheduledStart: at("2026-01-07T15:00:00Z"),
    scheduledEnd: at("2026-01-07T16:00:00Z"),
    completedAt: at("2026-01-08T15:00:00Z"),
    assign: k.members.tech2,
  });
  // 05:00Z on the 7th is still the 6th in Chicago.
  await job(k, { priority: "normal", status: "new", createdAt: at("2026-01-07T05:00:00Z") });
  // 23:30 on the 11th in Chicago: inside. 00:30 on the 12th: outside.
  await job(k, { status: "canceled", createdAt: at("2026-01-12T05:30:00Z") });
  await job(k, { status: "new", createdAt: at("2026-01-12T06:30:00Z") });
  // Deleted jobs never count.
  await job(k, {
    status: "completed",
    createdAt: at("2026-01-06T15:00:00Z"),
    completedAt: at("2026-01-06T16:00:00Z"),
    deletedAt: at("2026-01-09T00:00:00Z"),
  });
  // Previous period (2025-12-29 … 2026-01-04).
  await job(k, {
    priority: "normal",
    status: "completed",
    createdAt: at("2025-12-30T15:00:00Z"),
    firstScheduledAt: at("2025-12-30T17:00:00Z"),
    completedAt: at("2025-12-31T15:00:00Z"),
  });

  // Risk fixture: an overdue urgent request, a fresh normal one, a late visit and a late but finished one.
  await job(r, {
    priority: "urgent",
    status: "new",
    createdAt: at("2026-01-07T05:00:00Z"),
    title: "Overdue urgent",
  });
  await job(r, {
    priority: "normal",
    status: "new",
    createdAt: at("2026-01-07T05:00:00Z"),
    title: "Fresh normal",
  });
  await job(r, {
    status: "in_progress",
    createdAt: at("2026-01-06T05:00:00Z"),
    scheduledStart: at("2026-01-07T08:00:00Z"),
    scheduledEnd: at("2026-01-07T10:00:00Z"),
    title: "Running late",
    assign: r.members.tech2,
  });
  await job(r, {
    status: "completed",
    createdAt: at("2026-01-06T05:00:00Z"),
    scheduledEnd: at("2026-01-07T10:00:00Z"),
    title: "Done on time",
  });
  await t.owner.insert(s.expenseRequest).values({
    organizationId: r.orgId,
    jobId: r.ids.job,
    requesterMemberId: r.members.tech,
    item: "Capacitor",
    quantity: 2,
    unitCostMinor: 1500,
    totalMinor: 3000,
    currency: "USD",
    reason: "Failed",
    status: "approved",
    createdAt: at("2026-01-07T10:00:00Z"),
  });
});
afterAll(async () => t?.close());

const range = (from: string, to: string, extra: Partial<ReportFilters> = {}): ReportFilters => ({
  from,
  to,
  timeZone: TZ,
  ...extra,
});

describe("dashboard aggregations (DSH-01, DSH-02)", () => {
  it("computes the KPIs for a period in the organization's time zone", async () => {
    const kpis = await runIn(k, (st) => st.dashboard.kpis(range("2026-01-05", "2026-01-11")));
    expect(kpis).toEqual({
      created: 4,
      completed: 2,
      completedWithinTarget: 1,
      completedFirstVisit: 1,
      avgResponseMin: 120,
      avgResolutionMin: 1590,
    });
    const prev = await runIn(k, (st) => st.dashboard.kpis(range("2025-12-29", "2026-01-04")));
    expect(prev).toMatchObject({ created: 1, completed: 1, completedWithinTarget: 1, avgResponseMin: 120 });
    const empty = await runIn(k, (st) => st.dashboard.kpis(range("2025-06-01", "2025-06-07")));
    expect(empty).toEqual({
      created: 0,
      completed: 0,
      completedWithinTarget: 0,
      completedFirstVisit: 0,
      avgResponseMin: null,
      avgResolutionMin: null,
    });
  });

  it("applies the technician and service type filters", async () => {
    const tech = await runIn(k, (st) =>
      st.dashboard.kpis(range("2026-01-05", "2026-01-11", { technicianId: k.members.tech })),
    );
    expect(tech).toMatchObject({ created: 1, completed: 1, completedWithinTarget: 1, avgResolutionMin: 300 });
    const type = await runIn(k, (st) =>
      st.dashboard.kpis(range("2026-01-05", "2026-01-11", { serviceTypeId: k.ids.serviceType })),
    );
    expect(type).toMatchObject({ created: 1, completed: 1 });
  });

  it("groups by status per day or week, and the SLA trend by completion day", async () => {
    const f = range("2026-01-05", "2026-01-11");
    expect(await runIn(k, (st) => st.dashboard.statusSeries(f, "day"))).toEqual([
      { bucket: "2026-01-05", status: "completed", count: 1 },
      { bucket: "2026-01-06", status: "completed", count: 1 },
      { bucket: "2026-01-06", status: "new", count: 1 },
      { bucket: "2026-01-11", status: "canceled", count: 1 },
    ]);
    expect(await runIn(k, (st) => st.dashboard.statusSeries(f, "week"))).toEqual([
      { bucket: "2026-01-05", status: "canceled", count: 1 },
      { bucket: "2026-01-05", status: "completed", count: 2 },
      { bucket: "2026-01-05", status: "new", count: 1 },
    ]);
    expect(await runIn(k, (st) => st.dashboard.slaTrend(f, "day"))).toEqual([
      { bucket: "2026-01-05", completed: 1, withinTarget: 1 },
      { bucket: "2026-01-08", completed: 1, withinTarget: 0 },
    ]);
  });

  it("counts jobs by service type and scheduled time per technician", async () => {
    const f = range("2026-01-05", "2026-01-11");
    const types = await runIn(k, (st) => st.dashboard.byServiceType(f));
    expect(types.sort((a, b) => b.created - a.created)).toEqual([
      { serviceTypeId: null, name: null, created: 3, completed: 1 },
      { serviceTypeId: k.ids.serviceType, name: "AC repair", created: 1, completed: 1 },
    ]);
    const load = await runIn(k, (st) => st.dashboard.workload(f));
    expect(load.sort((a, b) => b.scheduledMin - a.scheduledMin)).toEqual([
      { memberId: k.members.tech, jobs: 1, scheduledMin: 120, completed: 1 },
      { memberId: k.members.tech2, jobs: 1, scheduledMin: 60, completed: 1 },
    ]);
    expect(await runIn(k, (st) => st.dashboard.dayStatusCounts("2026-01-07", TZ))).toEqual([
      { status: "completed", count: 1 },
    ]);
  });

  it("returns a member's completed visits and recorded work time", async () => {
    expect(
      await runIn(k, (st) => st.dashboard.ownStats(k.members.tech, "2026-01-05", "2026-01-11", TZ)),
    ).toEqual({
      completed: 1,
      workMin: 0,
    });
    // The helper's 09:00–10:00 UTC work entry on Nov 11 is the morning of Nov 11 in Chicago.
    expect(
      await runIn(k, (st) => st.dashboard.ownStats(k.members.tech, "2026-11-11", "2026-11-11", TZ)),
    ).toEqual({
      completed: 0,
      workMin: 60,
    });
  });
});

describe("dispatcher home (DSH-04)", () => {
  it("lists at-risk jobs, most overdue first", async () => {
    const risk = await runIn(r, (st) => st.dashboard.atRisk(at("2026-01-07T12:00:00Z"), 10));
    expect(risk.total).toBe(2);
    expect(risk.rows.map((x) => [x.title, x.status, x.assignees])).toEqual([
      ["Overdue urgent", "new", []],
      ["Running late", "in_progress", ["r tech2"]],
    ]);
    expect(risk.rows[0]!.createdAt.toISOString()).toBe("2026-01-07T05:00:00.000Z");
    const none = await runIn(r, (st) => st.dashboard.atRisk(at("2026-01-01T00:00:00Z"), 10));
    expect(none).toEqual({ total: 0, rows: [] });
  });

  it("lists pending approvals with their job and requester", async () => {
    const pending = await runIn(r, (st) => st.dashboard.pendingApprovals(5));
    expect(pending.total).toBe(1);
    expect(pending.rows).toEqual([
      expect.objectContaining({
        item: "Drain pump",
        totalMinor: 4500,
        currency: "USD",
        requesterName: "r tech",
        jobNumber: 1,
        jobTitle: "Job r",
      }),
    ]);
  });
});

describe("saved views (JOB-04)", () => {
  it("lists own and shared views and removes them", async () => {
    await runIn(r, async (st) => {
      expect(await st.savedViews.list("jobs", r.members.owner)).toEqual([]);
      const mine = await st.savedViews.list("jobs", r.members.dispatcher);
      expect(mine.map((v) => [v.name, v.ownerName, v.shared])).toEqual([["Urgent", "r dispatcher", false]]);
      const shared = await st.savedViews.create({
        memberId: r.members.owner,
        resource: "jobs",
        name: "All open",
        query: "status=new",
        shared: true,
      });
      expect(shared).toMatchObject({ name: "All open", ownerName: "r owner", shared: true });
      expect((await st.savedViews.list("jobs", r.members.dispatcher)).map((v) => v.name)).toEqual([
        "Urgent",
        "All open",
      ]);
      expect(await st.savedViews.countByMember(r.members.owner, "jobs")).toBe(1);
      expect(await st.savedViews.get(shared.id)).toMatchObject({ id: shared.id });
      expect(await st.savedViews.remove(shared.id)).toBe(true);
      expect(await st.savedViews.remove(shared.id)).toBe(false);
      expect(await st.savedViews.get(shared.id)).toBeNull();
    });
  });
});

describe("search (JOB-11)", () => {
  it("finds jobs by number or title, customers and sites", async () => {
    const hits = await runIn(r, (st) => st.search.search("job r", { limit: 5 }));
    expect(hits.jobs.map((j) => [j.number, j.title, j.customerName])).toEqual([[1, "Job r", "Customer r"]]);
    const byNumber = await runIn(r, (st) => st.search.search("JOB-000001", { limit: 5 }));
    expect(byNumber.jobs.map((j) => j.number)).toEqual([1]);
    const customer = await runIn(r, (st) => st.search.search("customer", { limit: 5 }));
    expect(customer.customers).toEqual([
      { id: r.ids.customer, name: "Customer r", type: "residential", city: "Austin" },
    ]);
    expect(customer.sites.map((x) => x.label)).toEqual(["Home"]);
    const site = await runIn(r, (st) => st.search.search("1 main", { limit: 5 }));
    expect(site.sites.map((x) => [x.line1, x.customerName])).toEqual([["1 Main", "Customer r"]]);
    // Wildcards in the query are literal.
    expect((await runIn(r, (st) => st.search.search("%%", { limit: 5 }))).jobs).toEqual([]);
  });

  it("limits technicians to their assigned jobs and those jobs' customers and sites", async () => {
    const tech = await runIn(r, (st) =>
      st.search.search("r", { limit: 10, assignedMemberId: r.members.tech }),
    );
    expect(tech.jobs.map((j) => j.title)).toEqual(["Job r"]);
    expect(tech.customers.map((c) => c.name)).toEqual(["Customer r"]);
    const other = await runIn(r, (st) =>
      st.search.search("job r", { limit: 10, assignedMemberId: r.members.owner }),
    );
    expect(other).toEqual({ jobs: [], customers: [], sites: [] });
  });
});

describe("equipment (CUS-03)", () => {
  it("creates, updates, soft-deletes and shows service history", async () => {
    await runIn(r, async (st) => {
      const unit = await st.equipment.create(r.ids.site, {
        type: "Heat pump",
        brand: "Daikin",
        model: null,
        serial: "SN-1",
        installDate: "2024-05-01",
        warrantyEnd: "2029-05-01",
        notes: "Roof",
      });
      expect(unit).toMatchObject({ siteId: r.ids.site, type: "Heat pump", notes: "Roof" });
      expect(await st.equipment.update(unit.id, { model: "FTX" })).toMatchObject({
        model: "FTX",
        brand: "Daikin",
      });
      expect(await st.equipment.update(randomUUID(), { model: "X" })).toBeNull();
      expect(await st.equipment.softDelete(unit.id)).toBe(true);
      expect(await st.equipment.softDelete(unit.id)).toBe(false);
      expect(await st.equipment.get(unit.id)).toBeNull();

      const history = await st.equipment.history(r.ids.equipment, { limit: 10 });
      expect(history.map((h) => [h.number, h.title, h.serviceTypeName, h.technicians])).toEqual([
        [1, "Job r", "AC repair", ["r tech"]],
      ]);
      expect(
        await st.equipment.history(r.ids.equipment, { limit: 10, assignedMemberId: r.members.tech }),
      ).toHaveLength(1);
      expect(
        await st.equipment.history(r.ids.equipment, { limit: 10, assignedMemberId: r.members.tech2 }),
      ).toEqual([]);
    });
  });
});
