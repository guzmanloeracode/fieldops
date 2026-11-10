import type { RecurrenceUnit } from "@fieldops/shared";

// Occurrence dates of a maintenance plan (JOB-13). Pure calendar math on "YYYY-MM-DD" dates in the
// organization's time zone. Occurrence n is always computed from the start date (start + n × interval), never
// from the previous occurrence, so month ends don't drift: Jan 31 monthly gives Feb 28 (29 in a leap year),
// then Mar 31 again.

export interface RecurrenceRule {
  unit: RecurrenceUnit;
  /** Every `count` units; at least 1. */
  count: number;
  startsOn: string;
  /** The last possible date, inclusive; null for no end. */
  endsOn: string | null;
}

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** No plan lists more dates than this in one call. */
const MAX_DATES = 1000;

function parse(date: string): { y: number; m: number; d: number } {
  const match = DATE.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (date: string) => {
  const { y, m, d } = parse(date);
  return Date.UTC(y, m, d);
};

/** Days in a month (month 0–11). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The date `months` calendar months after `date`, with the day clamped to the end of a shorter month. */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parse(date);
  const total = y * 12 + m + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  return format(Date.UTC(year, month, Math.min(d, daysInMonth(year, month))));
}

function stepDays(rule: RecurrenceRule): number | null {
  if (rule.unit === "day") return rule.count;
  if (rule.unit === "week") return rule.count * 7;
  return null;
}

function stepMonths(rule: RecurrenceRule): number {
  return rule.unit === "year" ? rule.count * 12 : rule.count;
}

/** Occurrence `n` (0 = the start date), ignoring the end date. */
export function occurrenceAt(rule: RecurrenceRule, n: number): string {
  const days = stepDays(rule);
  if (days !== null) return format(utc(rule.startsOn) + n * days * DAY_MS);
  return addMonths(rule.startsOn, n * stepMonths(rule));
}

/** The index of the first occurrence on or after `date`, ignoring the end date. */
export function indexOnOrAfter(rule: RecurrenceRule, date: string): number {
  if (date <= rule.startsOn) return 0;
  const days = stepDays(rule);
  if (days !== null) return Math.ceil(Math.round((utc(date) - utc(rule.startsOn)) / DAY_MS) / days);
  const a = parse(rule.startsOn);
  const b = parse(date);
  // Every earlier index falls in an earlier month; at most one step separates the estimate from the answer.
  let n = Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / stepMonths(rule));
  while (occurrenceAt(rule, n) < date) n += 1;
  return n;
}

const withinEnd = (rule: RecurrenceRule, date: string) => rule.endsOn === null || date <= rule.endsOn;

/** The first occurrence on or after `date`, or null when the plan ends before it. */
export function nextOccurrence(rule: RecurrenceRule, date: string): string | null {
  const next = occurrenceAt(rule, indexOnOrAfter(rule, date));
  return withinEnd(rule, next) ? next : null;
}

/** Occurrences from `from` to `to`, both included, within the plan's end date. */
export function occurrencesBetween(rule: RecurrenceRule, from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = indexOnOrAfter(rule, from); out.length < MAX_DATES; n++) {
    const date = occurrenceAt(rule, n);
    if (date > to || !withinEnd(rule, date)) break;
    out.push(date);
  }
  return out;
}

/** The next `count` occurrences on or after `from`, within the plan's end date. */
export function upcomingOccurrences(rule: RecurrenceRule, from: string, count: number): string[] {
  const out: string[] = [];
  for (let n = indexOnOrAfter(rule, from); out.length < Math.min(count, MAX_DATES); n++) {
    const date = occurrenceAt(rule, n);
    if (!withinEnd(rule, date)) break;
    out.push(date);
  }
  return out;
}

/**
 * Where generation continues after the dates up to `after` are covered: the first occurrence after it. Past the
 * end date this is still the following occurrence, so a finished plan's `next_on` lies beyond `ends_on`.
 */
export function occurrenceAfter(rule: RecurrenceRule, after: string): string {
  return occurrenceAt(rule, indexOnOrAfter(rule, format(utc(after) + DAY_MS)));
}

/** True when the plan has no occurrence left on or after `nextOn`. */
export function hasEnded(rule: RecurrenceRule, nextOn: string): boolean {
  return rule.endsOn !== null && nextOn > rule.endsOn;
}
