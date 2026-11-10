import { formatMoney, parseMajor, toMajor } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";
import { formatCalendarDate, intlLocale } from "@/lib/format";

// Money in billing forms and pages: amounts are minor units; inputs are typed in major units (ADR 009). Display
// helpers take the reader's locale (SET-05); English when it's left out.

export const money = (amountMinor: number, currency: Currency, locale?: string) =>
  formatMoney({ amountMinor, currency }, intlLocale(locale));

/** A minor amount as the text of an input: "1250.50", or "150000" for IDR. */
export const toInput = (minor: number, currency: Currency) =>
  toMajor(minor, currency).toFixed(currency === "IDR" ? 0 : 2);

/** Parses an amount typed in major units; null when it isn't a non-negative amount. */
export function fromInput(value: string, currency: Currency): number | null {
  const minor = parseMajor(value, currency);
  return minor === null || minor < 0 ? null : minor;
}

/** Basis points as a percent label: 825 → "8.25%" ("8,25%" in Indonesian). */
export const percent = (bps: number, locale?: string) =>
  `${(bps / 100).toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 })}%`;

/** A local date ("2026-11-24") as "Nov 24, 2026" or "24 Nov 2026", or "—". */
export function dayText(date: string | null | undefined, locale?: string): string {
  if (!date) return "—";
  return formatCalendarDate(date, "date", locale);
}
