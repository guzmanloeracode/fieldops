import type { Currency } from "@fieldops/shared";

/**
 * Money is stored as integer minor units plus an ISO 4217 currency code (ADR 009).
 * ISO gives both USD and IDR two minor digits; IDR amounts are displayed without decimals.
 */
export const CURRENCY_INFO: Record<Currency, { exponent: number; displayDigits: number; locale: string }> = {
  USD: { exponent: 2, displayDigits: 2, locale: "en-US" },
  IDR: { exponent: 2, displayDigits: 0, locale: "id-ID" },
};

export interface Money {
  amountMinor: number;
  currency: Currency;
}

function assertSafe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount is outside the safe integer range");
  return n;
}

export function money(amountMinor: number, currency: Currency): Money {
  return { amountMinor: assertSafe(amountMinor), currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** Multiplies by a quantity or factor and rounds half away from zero to a whole minor unit. */
export function multiplyMoney(a: Money, factor: number): Money {
  const raw = a.amountMinor * factor;
  return money(Math.sign(raw) * Math.round(Math.abs(raw)), a.currency);
}

/** Tax in basis points (1 bp = 0.01%), rounded half away from zero. */
export function taxFor(net: Money, rateBps: number): Money {
  return multiplyMoney(net, rateBps / 10_000);
}

export function toMajor(amountMinor: number, currency: Currency): number {
  return amountMinor / 10 ** CURRENCY_INFO[currency].exponent;
}

/** Parses user input such as "1,250.50" or "150000" into minor units. Returns null when invalid. */
export function parseMajor(input: string, currency: Currency): number | null {
  const cleaned = input.replace(/[\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const { exponent } = CURRENCY_INFO[currency];
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  if (frac.length > exponent) return null;
  const minor = Number(whole) * 10 ** exponent + Number(frac.padEnd(exponent, "0") || "0");
  if (!Number.isSafeInteger(minor)) return null;
  return cleaned.startsWith("-") ? -minor : minor;
}

export function formatMoney(m: Money, locale?: string): string {
  const info = CURRENCY_INFO[m.currency];
  return new Intl.NumberFormat(locale ?? info.locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: info.displayDigits,
    maximumFractionDigits: info.displayDigits,
  }).format(toMajor(m.amountMinor, m.currency));
}
