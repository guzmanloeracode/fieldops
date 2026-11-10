// Number formatting for dashboards. Dates are plain "YYYY-MM-DD" local dates of the organization.

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export const shortDate = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
export const longDate = (d: string) => longFmt.format(new Date(`${d}T00:00:00Z`));

/** 45 min, 3.5 h or 2.1 d. */
export function formatMinutes(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 24 * 60) return `${(min / 60).toFixed(1).replace(/\.0$/, "")} h`;
  return `${(min / 60 / 24).toFixed(1).replace(/\.0$/, "")} d`;
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

export const formatCount = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

export const hours = (min: number) => Math.round((min / 60) * 10) / 10;
