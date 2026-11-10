import { JOB_STATUSES, dashboardQuerySchema, type JobStatus } from "@fieldops/shared";
import {
  bucketStarts,
  localDateString,
  monthStart,
  resolveDateRange,
  weekStart,
  workingMinutesBetween,
  type DateRange,
} from "../domain/date-range";
import { assertCan } from "../domain/permissions";
import type { PendingApprovalRow, ReportFilters, RiskRow } from "./insights-types";
import type { JobView, MemberRecord, OrganizationRecord, ServiceContext } from "./types";

// Dashboards (DSH-01 – DSH-04). Every number comes from SQL aggregations in the dashboard repository; this
// layer resolves the period, adds the previous period for comparison and joins in working hours.

export interface Comparison {
  value: number | null;
  previous: number | null;
}

export interface DashboardOverview {
  range: DateRange;
  today: string;
  filters: { technicianId: string | null; serviceTypeId: string | null };
  kpis: {
    created: Comparison;
    completed: Comparison;
    /** Share of completed jobs that met their resolution target (0–1, SLA-02). */
    slaCompliance: Comparison;
    /** Share of jobs created in the period that were scheduled within their response target (0–1). */
    responseCompliance: Comparison;
    avgResponseMin: Comparison;
    avgResolutionMin: Comparison;
    /** Share of completed jobs that needed one visit (0–1). */
    firstVisitRate: Comparison;
  };
  statusSeries: { bucket: string; counts: Record<JobStatus, number>; total: number }[];
  slaTrend: {
    bucket: string;
    completed: number;
    withinTarget: number;
    measured: number;
    rate: number | null;
  }[];
  byServiceType: { serviceTypeId: string | null; name: string; created: number; completed: number }[];
  workload: TechnicianLoad[];
}

export interface TechnicianLoad {
  memberId: string;
  name: string;
  jobs: number;
  completed: number;
  scheduledMin: number;
  availableMin: number;
  /** Scheduled ÷ available working time, or null without working hours. */
  utilization: number | null;
}

export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function emptyCounts(): Record<JobStatus, number> {
  return Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
}

/** Parses dashboard query parameters; anything invalid falls back to the default (last 30 days). */
export function parseDashboardQuery(raw: unknown) {
  const parsed = dashboardQuerySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : dashboardQuerySchema.parse({});
}

function technicianLoads(
  members: MemberRecord[],
  org: OrganizationRecord,
  rows: { memberId: string; jobs: number; scheduledMin: number; completed: number }[],
  from: string,
  to: string,
  only?: string,
): TechnicianLoad[] {
  const byMember = new Map(rows.map((r) => [r.memberId, r]));
  return members
    .filter((m) => (only ? m.id === only : m.role === "technician" || byMember.has(m.id)))
    .map((m) => {
      const r = byMember.get(m.id);
      const availableMin = workingMinutesBetween(m.workingHours ?? org.businessHours, from, to);
      const scheduledMin = r?.scheduledMin ?? 0;
      return {
        memberId: m.id,
        name: m.name,
        jobs: r?.jobs ?? 0,
        completed: r?.completed ?? 0,
        scheduledMin,
        availableMin,
        utilization: rate(scheduledMin, availableMin),
      };
    })
    .sort((a, b) => b.scheduledMin - a.scheduledMin || a.name.localeCompare(b.name));
}

/** Owner and dispatcher KPIs and charts for a period, compared with the period before (DSH-01 – DSH-03). */
export async function getOverview(ctx: ServiceContext, raw: unknown): Promise<DashboardOverview> {
  assertCan(ctx.actor, "dashboard.operational");
  const q = parseDashboardQuery(raw);
  const org = await ctx.store.organization.get();
  const today = localDateString(ctx.now, org.timezone);
  const range = resolveDateRange(q, today);
  const f: ReportFilters = {
    from: range.from,
    to: range.to,
    timeZone: org.timezone,
    technicianId: q.technician,
    serviceTypeId: q.service_type,
  };
  const prev: ReportFilters = { ...f, from: range.prevFrom, to: range.prevTo };
  const repo = ctx.store.dashboard;
  const [cur, before, series, sla, types, load, members] = await Promise.all([
    repo.kpis(f),
    repo.kpis(prev),
    repo.statusSeries(f, range.bucket),
    repo.slaTrend(f, range.bucket),
    repo.byServiceType(f),
    repo.workload(f),
    ctx.store.members.list(),
  ]);

  const buckets = bucketStarts(range.from, range.to, range.bucket);
  const seriesMap = new Map(buckets.map((b) => [b, emptyCounts()]));
  for (const r of series) {
    const counts = seriesMap.get(r.bucket);
    if (counts) counts[r.status] += r.count;
  }
  const slaMap = new Map(sla.map((r) => [r.bucket, r]));

  return {
    range,
    today,
    filters: { technicianId: q.technician ?? null, serviceTypeId: q.service_type ?? null },
    kpis: {
      created: { value: cur.created, previous: before.created },
      completed: { value: cur.completed, previous: before.completed },
      slaCompliance: {
        value: rate(cur.completedWithinTarget, cur.completedSlaMeasured),
        previous: rate(before.completedWithinTarget, before.completedSlaMeasured),
      },
      responseCompliance: {
        value: rate(cur.responseMet, cur.responseMeasured),
        previous: rate(before.responseMet, before.responseMeasured),
      },
      avgResponseMin: { value: cur.avgResponseMin, previous: before.avgResponseMin },
      avgResolutionMin: { value: cur.avgResolutionMin, previous: before.avgResolutionMin },
      firstVisitRate: {
        value: rate(cur.completedFirstVisit, cur.completed),
        previous: rate(before.completedFirstVisit, before.completed),
      },
    },
    statusSeries: buckets.map((bucket) => {
      const counts = seriesMap.get(bucket)!;
      return { bucket, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
    }),
    slaTrend: buckets.map((bucket) => {
      const r = slaMap.get(bucket);
      const completed = r?.completed ?? 0;
      const withinTarget = r?.withinTarget ?? 0;
      const measured = r?.measured ?? 0;
      return { bucket, completed, withinTarget, measured, rate: rate(withinTarget, measured) };
    }),
    byServiceType: types
      .map((t) => ({ ...t, name: t.name ?? "No service type" }))
      .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name)),
    workload: technicianLoads(members, org, load, range.from, range.to, q.technician),
  };
}

export interface TodayOverview {
  date: string;
  statusCounts: Record<JobStatus, number>;
  scheduledTotal: number;
  technicians: TechnicianLoad[];
  unassigned: { total: number; rows: JobView[] };
  atRisk: { total: number; rows: RiskRow[] };
  approvals: { total: number; rows: PendingApprovalRow[] };
}

/** Dispatcher home: today's board, the unassigned queue, at-risk jobs and pending approvals (DSH-04). */
export async function getToday(ctx: ServiceContext): Promise<TodayOverview> {
  assertCan(ctx.actor, "dashboard.operational");
  const org = await ctx.store.organization.get();
  const date = localDateString(ctx.now, org.timezone);
  const repo = ctx.store.dashboard;
  const [counts, load, risk, approvals, unassigned, members] = await Promise.all([
    repo.dayStatusCounts(date, org.timezone),
    repo.workload({ from: date, to: date, timeZone: org.timezone }),
    repo.atRisk(8),
    repo.pendingApprovals(5),
    ctx.store.jobs.list({
      status: ["new"],
      unassigned: true,
      sort: "-priority,created_at",
      limit: 6,
      page: 1,
    }),
    ctx.store.members.list(),
  ]);
  const statusCounts = emptyCounts();
  for (const c of counts) statusCounts[c.status] += c.count;
  return {
    date,
    statusCounts,
    scheduledTotal: Object.entries(statusCounts)
      .filter(([s]) => s !== "canceled")
      .reduce((a, [, n]) => a + n, 0),
    technicians: technicianLoads(members, org, load, date, date),
    unassigned: { total: unassigned.total ?? unassigned.rows.length, rows: unassigned.rows },
    atRisk: risk,
    approvals,
  };
}

/** Every open job whose SLA is at risk or breached, for the CSV export (DSH-05). Capped at `limit`. */
export async function getAtRisk(ctx: ServiceContext, limit = 1000) {
  assertCan(ctx.actor, "dashboard.operational");
  return ctx.store.dashboard.atRisk(limit);
}

/** New jobs without a technician, most urgent first, for the CSV export (DSH-05). Capped at `limit`. */
export async function getUnassigned(ctx: ServiceContext, limit = 1000): Promise<JobView[]> {
  assertCan(ctx.actor, "dashboard.operational");
  const page = await ctx.store.jobs.list({
    status: ["new"],
    unassigned: true,
    sort: "-priority,created_at",
    limit,
  });
  return page.rows;
}

/** Pending parts and expense requests, for the CSV export (DSH-05). Capped at `limit`. */
export async function getPendingApprovals(ctx: ServiceContext, limit = 1000) {
  assertCan(ctx.actor, "dashboard.operational");
  return ctx.store.dashboard.pendingApprovals(limit);
}

export interface OwnStatsOverview {
  today: string;
  week: { from: string; completed: number; workMin: number };
  month: { from: string; completed: number; workMin: number };
}

/** A technician's own numbers: visits completed and time on site this week and month. */
export async function getOwnStats(ctx: ServiceContext): Promise<OwnStatsOverview> {
  assertCan(ctx.actor, "dashboard.own");
  const org = await ctx.store.organization.get();
  const today = localDateString(ctx.now, org.timezone);
  const week = weekStart(today);
  const month = monthStart(today);
  const [w, m] = await Promise.all([
    ctx.store.dashboard.ownStats(ctx.actor.memberId, week, today, org.timezone),
    ctx.store.dashboard.ownStats(ctx.actor.memberId, month, today, org.timezone),
  ]);
  return { today, week: { from: week, ...w }, month: { from: month, ...m } };
}
