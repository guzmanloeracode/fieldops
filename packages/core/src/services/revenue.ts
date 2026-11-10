import type { Currency } from "@fieldops/shared";
import { bucketStarts, localDateString, resolveDateRange, type DateRange } from "../domain/date-range";
import { assertCan } from "../domain/permissions";
import { parseDashboardQuery, type Comparison } from "./dashboard";
import type { ReceivablesSummary } from "./billing-types";
import type { ReportFilters } from "./insights-types";
import type { ServiceContext } from "./types";

// Revenue on the owner dashboard (DSH-01, DSH-02): invoiced and collected in the period against the period
// before, receivables at the end of each period, and the trend. Owners and admins only (dashboard.financial).
// Revenue isn't split by technician or service type, so those dashboard filters don't apply to it.

export interface RevenueOverview {
  range: DateRange;
  currency: Currency;
  kpis: {
    /** Totals of invoices issued in the period, void ones excluded. */
    invoiced: Comparison;
    /** Payments received in the period. */
    collected: Comparison;
    /** Open balance at the end of the period (now for a period ending today). */
    receivables: Comparison;
    /** The part of the receivables past its due date. */
    overdue: Comparison;
  };
  counts: { invoices: number; payments: number };
  series: { bucket: string; invoicedMinor: number; collectedMinor: number }[];
  receivables: ReceivablesSummary;
}

export async function getRevenue(ctx: ServiceContext, raw: unknown): Promise<RevenueOverview> {
  assertCan(ctx.actor, "dashboard.financial");
  const q = parseDashboardQuery(raw);
  const org = await ctx.store.organization.get();
  const today = localDateString(ctx.now, org.timezone);
  const range = resolveDateRange(q, today);
  const f: ReportFilters = { from: range.from, to: range.to, timeZone: org.timezone };
  const prev: ReportFilters = { ...f, from: range.prevFrom, to: range.prevTo };
  const repo = ctx.store.billing;
  const end = range.to > today ? today : range.to;
  const [cur, before, series, open, openBefore] = await Promise.all([
    repo.revenueTotals(f),
    repo.revenueTotals(prev),
    repo.revenueSeries(f, range.bucket),
    repo.receivables(end),
    repo.receivables(range.prevTo),
  ]);
  const byBucket = new Map(series.map((r) => [r.bucket, r]));
  return {
    range,
    currency: org.currency,
    kpis: {
      invoiced: { value: cur.invoicedMinor, previous: before.invoicedMinor },
      collected: { value: cur.collectedMinor, previous: before.collectedMinor },
      receivables: { value: open.outstandingMinor, previous: openBefore.outstandingMinor },
      overdue: { value: open.overdueMinor, previous: openBefore.overdueMinor },
    },
    counts: { invoices: cur.invoicedCount, payments: cur.paymentCount },
    series: bucketStarts(range.from, range.to, range.bucket).map((bucket) => ({
      bucket,
      invoicedMinor: byBucket.get(bucket)?.invoicedMinor ?? 0,
      collectedMinor: byBucket.get(bucket)?.collectedMinor ?? 0,
    })),
    receivables: open,
  };
}
