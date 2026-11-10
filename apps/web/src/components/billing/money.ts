import { formatMoney, parseMajor, toMajor } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";

// Money in billing forms and pages: amounts are minor units; inputs are typed in major units (ADR 009).

export const money = (amountMinor: number, currency: Currency) => formatMoney({ amountMinor, currency });

/** A minor amount as the text of an input: "1250.50", or "150000" for IDR. */
export const toInput = (minor: number, currency: Currency) =>
  toMajor(minor, currency).toFixed(currency === "IDR" ? 0 : 2);

/** Parses an amount typed in major units; null when it isn't a non-negative amount. */
export function fromInput(value: string, currency: Currency): number | null {
  const minor = parseMajor(value, currency);
  return minor === null || minor < 0 ? null : minor;
}

/** Basis points as a percent label: 825 → "8.25%". */
export const percent = (bps: number) =>
  `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** A local date ("2026-11-24") as "Nov 24, 2026", or "—". */
export function dayText(date: string | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
