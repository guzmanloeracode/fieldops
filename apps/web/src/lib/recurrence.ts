// Display helpers for maintenance plans (JOB-13) and the SLA pause (SLA-04). Shared by server and client
// components.

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A plain "YYYY-MM-DD" date as "Mon, Nov 30, 2026" (no time zone: it is already a local date). */
export function formatDay(date: string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(style === "long" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "45 minutes", "3 h 20 min" or "2 days 4 h", with the `slaPause.duration*` messages of `recurrences`. */
export function formatPause(t: Translate, minutes: number): string {
  if (minutes < 60) return t("slaPause.durationMinutes", { m: minutes });
  if (minutes < 1440) return t("slaPause.durationHours", { h: Math.floor(minutes / 60), m: minutes % 60 });
  return t("slaPause.durationDays", { d: Math.floor(minutes / 1440), h: Math.floor((minutes % 1440) / 60) });
}

/** Where a job's plan lives: its customer's page, scrolled to the plan. */
export function planHref(customerId: string, planId: string): string {
  return `/customers/${customerId}#plan-${planId}`;
}
