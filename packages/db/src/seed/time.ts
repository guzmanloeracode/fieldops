import type { Tx } from "../client";

export const DAY = 86_400_000;

/** Offset of a time zone from UTC in ms at a given instant. */
export function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant;
}

/** The UTC instant of a wall-clock time in a time zone. */
export function zoned(y: number, m: number, d: number, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(y, m, d, 0, minutes);
  const offset = tzOffsetMs(guess, timeZone);
  return new Date(guess - offset);
}

export function localDate(instant: Date, timeZone: string): { y: number; m: number; d: number; dow: number } {
  const shifted = new Date(instant.getTime() + tzOffsetMs(instant.getTime(), timeZone));
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
  };
}

export async function insertBatches<T extends Record<string, unknown>>(
  tx: Tx,
  table: Parameters<Tx["insert"]>[0],
  rows: T[],
  size = 500,
) {
  for (let i = 0; i < rows.length; i += size) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await tx.insert(table).values(rows.slice(i, i + size) as any);
  }
}
