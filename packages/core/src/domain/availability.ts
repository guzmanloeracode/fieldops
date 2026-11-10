// Technician availability (SCH-04) and the pure checks behind scheduling conflicts (SCH-03).
// Working hours are wall-clock times in the organization's time zone; visits and time off are instants.

export interface WorkingHoursEntry {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** "HH:MM" */
  open: string;
  /** "HH:MM" */
  close: string;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

// Building an Intl.DateTimeFormat is far slower than using one, and business-hours SLA math calls this in loops.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of a time zone from UTC, in ms, at an instant. */
export function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function parseDate(date: string): { y: number; m: number; d: number } {
  const match = DATE.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** The instant of a wall-clock time (minutes after midnight) on a local date in a time zone. */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const { y, m, d } = parseDate(date);
  const guess = Date.UTC(y, m, d, 0, minutes);
  // Two passes settle the offset around daylight-saving changes.
  const first = guess - tzOffsetMs(guess, timeZone);
  return new Date(guess - tzOffsetMs(first, timeZone));
}

/** The local calendar date ("YYYY-MM-DD") of an instant in a time zone. */
export function localDateOf(instant: Date, timeZone: string): string {
  const shifted = new Date(instant.getTime() + tzOffsetMs(instant.getTime(), timeZone));
  return shifted.toISOString().slice(0, 10);
}

/** Minutes after local midnight of an instant in a time zone. */
export function localMinutesOf(instant: Date, timeZone: string): number {
  const shifted = new Date(instant.getTime() + tzOffsetMs(instant.getTime(), timeZone));
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function shiftDate(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Day of the week of a calendar date, 0 = Sunday. */
export function dayOfWeek(date: string): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}

/** "08:30" → 510. */
export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** A member's own hours, or the organization's business hours when they have none. */
export function effectiveHours(
  memberHours: readonly WorkingHoursEntry[] | null,
  businessHours: readonly WorkingHoursEntry[],
): WorkingHoursEntry[] {
  return [...(memberHours ?? businessHours)];
}

/** The working windows on one local date. A close at or before the open is ignored. */
export function workingWindows(
  hours: readonly WorkingHoursEntry[],
  date: string,
  timeZone: string,
): TimeRange[] {
  const dow = dayOfWeek(date);
  return hours
    .filter((h) => h.day === dow && hhmmToMinutes(h.close) > hhmmToMinutes(h.open))
    .sort((a, b) => hhmmToMinutes(a.open) - hhmmToMinutes(b.open))
    .map((h) => ({
      start: zonedInstant(date, hhmmToMinutes(h.open), timeZone),
      end: zonedInstant(date, hhmmToMinutes(h.close), timeZone),
    }));
}

/**
 * True when the visit fits inside one working window. With no hours configured at all (neither the member
 * nor the organization), every time counts as working time.
 */
export function isWithinWorkingHours(
  hours: readonly WorkingHoursEntry[],
  visit: TimeRange,
  timeZone: string,
): boolean {
  if (hours.length === 0) return true;
  const date = localDateOf(visit.start, timeZone);
  return workingWindows(hours, date, timeZone).some((w) => w.start <= visit.start && visit.end <= w.end);
}

/** "08:00–17:00" for the local date's hours, or null on a day off. */
export function describeHours(hours: readonly WorkingHoursEntry[], date: string): string | null {
  const dow = dayOfWeek(date);
  const today = hours
    .filter((h) => h.day === dow && hhmmToMinutes(h.close) > hhmmToMinutes(h.open))
    .sort((a, b) => hhmmToMinutes(a.open) - hhmmToMinutes(b.open));
  return today.length ? today.map((h) => `${h.open}–${h.close}`).join(", ") : null;
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Time-off entries that overlap the visit. */
export function overlappingTimeOff<T extends { startsAt: Date; endsAt: Date }>(
  entries: readonly T[],
  visit: TimeRange,
): T[] {
  return entries.filter((e) => rangesOverlap({ start: e.startsAt, end: e.endsAt }, visit));
}

/** Required skills the member lacks, compared case-insensitively. */
export function missingSkills(required: readonly string[], has: readonly string[]): string[] {
  const own = new Set(has.map((s) => s.toLowerCase()));
  return [...new Set(required.map((s) => s.toLowerCase()))].filter((s) => !own.has(s));
}

/** Snaps an instant to the nearest step (default 15 minutes). */
export function snapToMinutes(instant: Date, step = 15): Date {
  const ms = step * 60_000;
  return new Date(Math.round(instant.getTime() / ms) * ms);
}
