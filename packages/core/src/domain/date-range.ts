import type { DashboardRange } from "@fieldops/shared";

// Calendar math on plain "YYYY-MM-DD" dates in an organization's time zone. Reports work in local days;
// the database turns a local date into an instant with `(date)::timestamp at time zone <tz>`.

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: string): number {
  if (!ISO_DATE.test(date)) throw new RangeError(`Not a date: ${date}`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The calendar date of an instant in a time zone. */
export function localDateString(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Number of days from `from` to `to`, both included. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** Monday of the date's week (ISO weeks, like Postgres `date_trunc('week', …)`). */
export function weekStart(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

export type Bucket = "day" | "week";

export interface DateRange {
  from: string;
  to: string;
  /** The equal-length period right before, for comparisons (DSH-01). */
  prevFrom: string;
  prevTo: string;
  days: number;
  /** Chart granularity: days up to five weeks, weeks beyond. */
  bucket: Bucket;
}

export const MAX_RANGE_DAYS = 366;

function build(from: string, to: string): DateRange {
  const days = daysInclusive(from, to);
  return {
    from,
    to,
    prevFrom: addDays(from, -days),
    prevTo: addDays(from, -1),
    days,
    bucket: days <= 35 ? "day" : "week",
  };
}

/**
 * Turns a dashboard preset into dates (DSH-03). Rolling presets end today; "month" is the month to date and
 * "last_month" the whole previous month. A custom range that is missing, reversed or longer than a year
 * falls back to the last 30 days.
 */
export function resolveDateRange(
  q: { range: DashboardRange; from?: string; to?: string },
  today: string,
): DateRange {
  switch (q.range) {
    case "7d":
      return build(addDays(today, -6), today);
    case "90d":
      return build(addDays(today, -89), today);
    case "month":
      return build(monthStart(today), today);
    case "last_month": {
      const end = addDays(monthStart(today), -1);
      return build(monthStart(end), end);
    }
    case "custom":
      if (
        q.from &&
        q.to &&
        q.from <= q.to &&
        ISO_DATE.test(q.from) &&
        ISO_DATE.test(q.to) &&
        daysInclusive(q.from, q.to) <= MAX_RANGE_DAYS
      ) {
        return build(q.from, q.to);
      }
      return build(addDays(today, -29), today);
    case "30d":
    default:
      return build(addDays(today, -29), today);
  }
}

/** Every bucket start between two dates, so charts show empty days or weeks too. */
export function bucketStarts(from: string, to: string, bucket: Bucket): string[] {
  const out: string[] = [];
  let cur = bucket === "week" ? weekStart(from) : from;
  const step = bucket === "week" ? 7 : 1;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, step);
  }
  return out;
}

export interface DailyHours {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  open: string;
  close: string;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Working minutes on one date from weekly hours (several blocks per day are added up). */
export function workingMinutesOn(hours: readonly DailyHours[], date: string): number {
  const day = weekdayOf(date);
  return hours
    .filter((h) => h.day === day)
    .reduce((sum, h) => sum + Math.max(0, minutesOf(h.close) - minutesOf(h.open)), 0);
}

/** Working minutes over a date range, both ends included. */
export function workingMinutesBetween(hours: readonly DailyHours[], from: string, to: string): number {
  let total = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) total += workingMinutesOn(hours, d);
  return total;
}
