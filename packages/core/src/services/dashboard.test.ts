import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../domain/errors";
import { world } from "../test/fixtures";
import { fakeDashboard } from "../test/memory-insights";
import type { ReportFilters } from "./insights-types";
import * as dashboard from "./dashboard";
import * as jobs from "./jobs";

// ctxFor() pins "now" to 2026-11-10T09:00Z; the memory organization is in UTC.

describe("getOverview (DSH-01 – DSH-03)", () => {
  it("compares the period with the one before and fills every bucket", async () => {
    const w = world();
    w.data.org.businessHours = [1, 2, 3, 4, 5].map((day) => ({ day, open: "08:00", close: "16:00" }));
    w.tom.workingHours = [{ day: 2, open: "10:00", close: "12:00" }];
    const calls: ReportFilters[] = [];
    w.store.dashboard = fakeDashboard({
      async kpis(f) {
        calls.push(f);
        return f.from === "2026-11-04"
          ? {
              created: 40,
              completed: 20,
              completedWithinTarget: 15,
              completedFirstVisit: 18,
              avgResponseMin: 90,
              avgResolutionMin: 1200,
            }
          : {
              created: 30,
              completed: 0,
              completedWithinTarget: 0,
              completedFirstVisit: 0,
              avgResponseMin: null,
              avgResolutionMin: null,
            };
      },
      async statusSeries(_f, bucket) {
        expect(bucket).toBe("day");
        return [
          { bucket: "2026-11-05", status: "completed", count: 3 },
          { bucket: "2026-11-05", status: "new", count: 1 },
          { bucket: "2026-10-01", status: "new", count: 9 }, // outside the range: ignored
        ];
      },
      async slaTrend() {
        return [{ bucket: "2026-11-05", completed: 4, withinTarget: 3 }];
      },
      async byServiceType() {
        return [
          { serviceTypeId: null, name: null, created: 2, completed: 1 },
          { serviceTypeId: w.serviceTypeId, name: "AC repair", created: 9, completed: 5 },
        ];
      },
      async workload() {
        return [{ memberId: w.tom.id, jobs: 3, scheduledMin: 180, completed: 2 }];
      },
    });
    const out = await dashboard.getOverview(w.ctx(w.owner), {
      range: "7d",
      technician: undefined,
    });
    expect(out.range).toMatchObject({ from: "2026-11-04", to: "2026-11-10", prevFrom: "2026-10-28" });
    expect(out.today).toBe("2026-11-10");
    expect(calls.map((c) => [c.from, c.to, c.timeZone])).toEqual([
      ["2026-11-04", "2026-11-10", "UTC"],
      ["2026-10-28", "2026-11-03", "UTC"],
    ]);
    expect(out.kpis).toEqual({
      created: { value: 40, previous: 30 },
      completed: { value: 20, previous: 0 },
      slaCompliance: { value: 0.75, previous: null },
      avgResponseMin: { value: 90, previous: null },
      avgResolutionMin: { value: 1200, previous: null },
      firstVisitRate: { value: 0.9, previous: null },
    });
    expect(out.statusSeries).toHaveLength(7);
    const nov5 = out.statusSeries.find((s) => s.bucket === "2026-11-05")!;
    expect(nov5.total).toBe(4);
    expect(nov5.counts).toMatchObject({ completed: 3, new: 1, scheduled: 0 });
    expect(out.slaTrend.find((s) => s.bucket === "2026-11-05")).toEqual({
      bucket: "2026-11-05",
      completed: 4,
      withinTarget: 3,
      rate: 0.75,
    });
    expect(out.slaTrend[0]).toMatchObject({ completed: 0, rate: null });
    expect(out.byServiceType.map((t) => [t.name, t.created])).toEqual([
      ["AC repair", 9],
      ["No service type", 2],
    ]);
    // Tom works 2 h on Tuesdays only; Rina follows business hours (8 h × 5 weekdays in this range).
    expect(out.workload).toEqual([
      {
        memberId: w.tom.id,
        name: "Tom Tech",
        jobs: 3,
        completed: 2,
        scheduledMin: 180,
        availableMin: 120,
        utilization: 1.5,
      },
      {
        memberId: w.rina.id,
        name: "Rina Tech",
        jobs: 0,
        completed: 0,
        scheduledMin: 0,
        availableMin: 2400,
        utilization: 0,
      },
    ]);
  });

  it("passes filters through and limits the workload to the chosen technician", async () => {
    const w = world();
    let seen: ReportFilters | null = null;
    w.store.dashboard = fakeDashboard({
      async kpis(f) {
        seen = f;
        return fakeDashboard().kpis(f);
      },
    });
    const out = await dashboard.getOverview(w.ctx(w.dispatcher), {
      range: "90d",
      technician: w.rina.id,
      service_type: w.serviceTypeId,
    });
    expect(seen).toMatchObject({ technicianId: w.rina.id, serviceTypeId: w.serviceTypeId });
    expect(out.range.bucket).toBe("week");
    expect(out.filters).toEqual({ technicianId: w.rina.id, serviceTypeId: w.serviceTypeId });
    expect(out.workload.map((r) => r.name)).toEqual(["Rina Tech"]);
    expect(out.workload[0]!.utilization).toBeNull(); // no business hours in the memory org
  });

  it("falls back to the last 30 days on invalid input", async () => {
    const w = world();
    const out = await dashboard.getOverview(w.ctx(w.admin), { range: "forever" });
    expect(out.range).toMatchObject({ from: "2026-10-12", to: "2026-11-10" });
    expect(dashboard.parseDashboardQuery(undefined).range).toBe("30d");
  });

  it("is for office roles", async () => {
    const w = world();
    await expect(dashboard.getOverview(w.ctx(w.tom), {})).rejects.toThrow(ForbiddenError);
    await expect(dashboard.getToday(w.ctx(w.tom))).rejects.toThrow(ForbiddenError);
  });
});

describe("getToday (DSH-04)", () => {
  it("summarises today's board, the queue, risks and approvals", async () => {
    const w = world();
    const queued = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Waiting",
    });
    const created = new Date("2026-11-10T05:00:00Z");
    w.store.dashboard = fakeDashboard({
      async dayStatusCounts(date, tz) {
        expect([date, tz]).toEqual(["2026-11-10", "UTC"]);
        return [
          { status: "scheduled", count: 4 },
          { status: "completed", count: 2 },
          { status: "canceled", count: 1 },
        ];
      },
      async workload(f) {
        expect([f.from, f.to]).toEqual(["2026-11-10", "2026-11-10"]);
        return [{ memberId: w.dispatcher.id, jobs: 1, scheduledMin: 60, completed: 0 }];
      },
      async atRisk(now, limit) {
        expect(limit).toBe(8);
        const base = {
          number: 7,
          title: "Leak",
          customerName: "Cara",
          createdAt: created,
          assignees: [],
        };
        return {
          total: 2,
          rows: [
            { ...base, id: "a", status: "new", priority: "urgent", scheduledEnd: null },
            // Not at risk by the rule (e.g. stale row): dropped.
            { ...base, id: "b", status: "completed", priority: "urgent", scheduledEnd: null },
          ],
        };
      },
      async pendingApprovals() {
        return {
          total: 1,
          rows: [
            {
              id: "e1",
              item: "Drain pump",
              totalMinor: 4500,
              currency: "USD",
              requesterName: "Tom Tech",
              jobNumber: 7,
              jobTitle: "Leak",
              createdAt: created,
            },
          ],
        };
      },
    });
    const out = await dashboard.getToday(w.ctx(w.dispatcher));
    expect(out.date).toBe("2026-11-10");
    expect(out.statusCounts).toMatchObject({ scheduled: 4, completed: 2, canceled: 1, new: 0 });
    expect(out.scheduledTotal).toBe(6);
    // Technicians always appear; other members only with visits that day.
    expect(out.technicians.map((t) => t.name)).toEqual(["Dan Dispatcher", "Rina Tech", "Tom Tech"]);
    expect(out.unassigned.total).toBe(1);
    expect(out.unassigned.rows[0]!.id).toBe(queued.id);
    expect(out.atRisk.total).toBe(2);
    expect(out.atRisk.rows.map((r) => [r.id, r.reason])).toEqual([["a", "response_overdue"]]);
    expect(out.approvals.total).toBe(1);
  });
});

describe("getOwnStats", () => {
  it("returns a member's week and month", async () => {
    const w = world();
    const seen: string[] = [];
    w.store.dashboard = fakeDashboard({
      async ownStats(memberId, from, to) {
        expect(memberId).toBe(w.tom.id);
        seen.push(`${from}..${to}`);
        return { completed: from === "2026-11-09" ? 3 : 11, workMin: 200 };
      },
    });
    const out = await dashboard.getOwnStats(w.ctx(w.tom));
    expect(seen).toEqual(["2026-11-09..2026-11-10", "2026-11-01..2026-11-10"]);
    expect(out).toEqual({
      today: "2026-11-10",
      week: { from: "2026-11-09", completed: 3, workMin: 200 },
      month: { from: "2026-11-01", completed: 11, workMin: 200 },
    });
  });

  it("rate() divides safely", () => {
    expect(dashboard.rate(1, 4)).toBe(0.25);
    expect(dashboard.rate(1, 0)).toBeNull();
  });
});
