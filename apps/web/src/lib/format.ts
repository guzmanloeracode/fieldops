import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict, isSameDay } from "date-fns";

/** Dates are stored in UTC and shown in the organization's time zone (PRD §13). */
export function inZone(date: Date | string, timeZone: string): TZDate {
  return new TZDate(typeof date === "string" ? new Date(date) : date, timeZone);
}

export function formatDateTime(date: Date | string | null | undefined, timeZone: string): string {
  if (!date) return "—";
  return format(inZone(date, timeZone), "MMM d, yyyy · h:mm a");
}

export function formatDate(date: Date | string | null | undefined, timeZone: string): string {
  if (!date) return "—";
  return format(inZone(date, timeZone), "MMM d, yyyy");
}

export function formatWindow(
  start: Date | string | null,
  end: Date | string | null,
  timeZone: string,
): string {
  if (!start || !end) return "Not scheduled";
  const s = inZone(start, timeZone);
  const e = inZone(end, timeZone);
  return isSameDay(s, e)
    ? `${format(s, "EEE, MMM d · h:mm a")} – ${format(e, "h:mm a")}`
    : `${format(s, "MMM d, h:mm a")} – ${format(e, "MMM d, h:mm a")}`;
}

export function formatRelative(date: Date | string): string {
  return formatDistanceToNowStrict(typeof date === "string" ? new Date(date) : date, { addSuffix: true });
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
