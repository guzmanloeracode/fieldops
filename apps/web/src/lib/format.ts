import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict, isSameDay, type Locale as DateFnsLocale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { id as idID } from "date-fns/locale/id";
import { INTL_LOCALE, isLocale, type Locale } from "@/i18n/locales";

// Dates are stored in UTC and shown in the organization's time zone (PRD §13), in the reader's language (SET-05):
// English with a 12-hour clock, Bahasa Indonesia day-first with a 24-hour clock written 14.30 (PUEBI).
// Each function takes the UI locale last (`useLocale()` / `getLocale()`); English when it's left out.

const DATE_FNS: Record<Locale, DateFnsLocale> = { en: enUS, id: idID };

const PATTERNS: Record<
  Locale,
  {
    dateTime: string;
    date: string;
    time: string;
    dayTime: string;
    monthDayTime: string;
    day: string;
    monthDay: string;
    weekdayMonthDay: string;
  }
> = {
  en: {
    dateTime: "MMM d, yyyy · h:mm a",
    date: "MMM d, yyyy",
    time: "h:mm a",
    dayTime: "EEE, MMM d · h:mm a",
    monthDayTime: "MMM d, h:mm a",
    day: "EEEE, MMMM d",
    monthDay: "MMM d",
    weekdayMonthDay: "EEEE MMM d",
  },
  id: {
    dateTime: "d MMM yyyy · HH.mm",
    date: "d MMM yyyy",
    time: "HH.mm",
    dayTime: "EEE, d MMM · HH.mm",
    monthDayTime: "d MMM, HH.mm",
    day: "EEEE, d MMMM",
    monthDay: "d MMM",
    weekdayMonthDay: "EEEE d MMM",
  },
};

const lang = (locale: string | undefined): Locale => (isLocale(locale) ? locale : "en");

/** The date-fns locale for a UI locale, for pages that format with their own patterns. */
export function dateFnsLocale(locale: string | undefined): DateFnsLocale {
  return DATE_FNS[lang(locale)];
}

/** The BCP 47 tag for `Intl` and `formatMoney` (en-US or id-ID). */
export function intlLocale(locale: string | undefined): string {
  return INTL_LOCALE[lang(locale)];
}

/** A date-fns pattern in the UI locale. */
export function formatPattern(date: Date, pattern: string, locale?: string): string {
  return format(date, pattern, { locale: dateFnsLocale(locale) });
}

export function inZone(date: Date | string, timeZone: string): TZDate {
  return new TZDate(typeof date === "string" ? new Date(date) : date, timeZone);
}

export function formatDateTime(
  date: Date | string | null | undefined,
  timeZone: string,
  locale?: string,
): string {
  if (!date) return "—";
  return formatPattern(inZone(date, timeZone), PATTERNS[lang(locale)].dateTime, locale);
}

export function formatDate(
  date: Date | string | null | undefined,
  timeZone: string,
  locale?: string,
): string {
  if (!date) return "—";
  return formatPattern(inZone(date, timeZone), PATTERNS[lang(locale)].date, locale);
}

/** A day spelled out: "Thursday, November 5" or "Kamis, 5 November". */
export function formatDay(date: Date | string, timeZone: string, locale?: string): string {
  return formatPattern(inZone(date, timeZone), PATTERNS[lang(locale)].day, locale);
}

/**
 * A calendar date (`yyyy-MM-dd`, no time zone): "Thu" (weekday), "Nov 5" (monthDay), "Thursday Nov 5"
 * (weekdayMonthDay), "Nov 5, 2026" (date), "Thursday" (weekdayLong), day-first in Indonesian.
 */
export function formatCalendarDate(
  date: string,
  style: "weekday" | "weekdayLong" | "monthDay" | "weekdayMonthDay" | "date",
  locale?: string,
): string {
  const p = PATTERNS[lang(locale)];
  const pattern = {
    weekday: "EEE",
    weekdayLong: "EEEE",
    monthDay: p.monthDay,
    weekdayMonthDay: p.weekdayMonthDay,
    date: p.date,
  }[style];
  return formatPattern(new Date(`${date}T12:00:00Z`), pattern, locale);
}

/** A time of day such as 2:30 PM or 14.30. */
export function formatTime(date: Date | string, timeZone: string, locale?: string): string {
  return formatPattern(inZone(date, timeZone), PATTERNS[lang(locale)].time, locale);
}

/** A visit window: "Thu, Nov 5 · 9:00 AM – 11:00 AM" or "Kam, 5 Nov · 09.00 – 11.00". "—" when unset. */
export function formatWindow(
  start: Date | string | null,
  end: Date | string | null,
  timeZone: string,
  locale?: string,
): string {
  if (!start || !end) return "—";
  const p = PATTERNS[lang(locale)];
  const s = inZone(start, timeZone);
  const e = inZone(end, timeZone);
  return isSameDay(s, e)
    ? `${formatPattern(s, p.dayTime, locale)} – ${formatPattern(e, p.time, locale)}`
    : `${formatPattern(s, p.monthDayTime, locale)} – ${formatPattern(e, p.monthDayTime, locale)}`;
}

/** "3 hours ago", "in 2 days"; "3 jam yang lalu", "dalam 2 hari". */
export function formatRelative(date: Date | string, locale?: string): string {
  return formatDistanceToNowStrict(typeof date === "string" ? new Date(date) : date, {
    addSuffix: true,
    locale: dateFnsLocale(locale),
  });
}

/** A count or quantity with the locale's grouping (1,250 or 1.250). */
export function formatNumber(n: number, locale?: string, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(intlLocale(locale), options);
}

/** Value for <input type="datetime-local"> in the organization's time zone. */
export function toLocalInput(date: Date | string | null | undefined, timeZone: string): string {
  if (!date) return "";
  return format(inZone(date, timeZone), "yyyy-MM-dd'T'HH:mm");
}

/** Converts a datetime-local value entered in the organization's time zone to an ISO string. */
export function fromLocalInput(value: string, timeZone: string): string | null {
  if (!value) return null;
  const [d, t] = value.split("T");
  const [y, m, day] = (d ?? "").split("-").map(Number);
  const [h, min] = (t ?? "").split(":").map(Number);
  if (!y || !m || !day || h === undefined || min === undefined) return null;
  return new TZDate(y, m - 1, day, h, min, timeZone).toISOString();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
