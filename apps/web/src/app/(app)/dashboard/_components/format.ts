import type { JobStatus } from "@fieldops/shared";
import { formatCalendarDate, intlLocale } from "@/lib/format";

// Number formatting for dashboards, in the reader's language (SET-05). Dates are plain "YYYY-MM-DD" local dates of
// the organization.

export const shortDate = (d: string, locale?: string) => formatCalendarDate(d, "monthDay", locale);
export const longDate = (d: string, locale?: string) => formatCalendarDate(d, "date", locale);

const UNITS: Record<string, { min: string; h: string; d: string }> = {
  "en-US": { min: "min", h: "h", d: "d" },
  "id-ID": { min: "mnt", h: "jam", d: "hr" },
};

/** 45 min, 3.5 h or 2.1 d (45 mnt, 3,5 jam, 2,1 hr). */
export function formatMinutes(min: number | null, locale?: string): string {
  if (min === null || !Number.isFinite(min)) return "—";
  const tag = intlLocale(locale);
  const unit = UNITS[tag]!;
  const one = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 1 });
  if (min < 60) return `${Math.round(min)} ${unit.min}`;
  if (min < 24 * 60) return `${one(min / 60)} ${unit.h}`;
  return `${one(min / 60 / 24)} ${unit.d}`;
}

export function formatPercent(ratio: number | null, locale?: string): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 0 }).format(
    ratio,
  );
}

export const formatCount = (n: number | null, locale?: string) =>
  n === null ? "—" : n.toLocaleString(intlLocale(locale));

export const hours = (min: number) => Math.round((min / 60) * 10) / 10;

/** Status colors shared by the charts and their data tables (match the status badges). */
export const STATUS_COLORS: Record<JobStatus, string> = {
  new: "#94a3b8",
  scheduled: "#0ea5e9",
  en_route: "#6366f1",
  in_progress: "#f59e0b",
  on_hold: "#f97316",
  completed: "#10b981",
  canceled: "#a1a1aa",
};
