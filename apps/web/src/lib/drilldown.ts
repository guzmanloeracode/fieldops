import { dates } from "@fieldops/core";

// Links from dashboards into the jobs table with matching filters (DSH-03). Every filter the jobs page
// understands lives in the URL, so a drill-down is just a query string.

export type DrillParams = Record<string, string | number | boolean | null | undefined>;

export function jobsHref(params: DrillParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === false || v === "") continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

/** The last day of a chart bucket, capped at the end of the period. */
export function bucketEnd(start: string, bucket: "day" | "week", periodEnd: string): string {
  const end = bucket === "week" ? dates.addDays(start, 6) : start;
  return end > periodEnd ? periodEnd : end;
}
