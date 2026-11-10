import type { DiscountType, InvoiceStatus, QuoteStatus } from "@fieldops/shared";
import { ConflictError, ValidationError } from "./errors";

// Quotes and invoices (FIN-02, FIN-03, FIN-07): line totals, the document discount, tax, and the two lifecycles.
// Pure functions on integer minor units. Products are computed with BigInt, so large IDR amounts never lose
// precision; rounding is half away from zero everywhere (ADR 009).

const B10K = 10_000n;

/** a ÷ b rounded half away from zero (b > 0). */
function divRound(a: bigint, b: bigint): bigint {
  const negative = a < 0n;
  const abs = negative ? -a : a;
  const q = (abs * 2n + b) / (2n * b);
  return negative ? -q : q;
}

function toSafe(n: bigint): number {
  const v = Number(n);
  if (!Number.isSafeInteger(v)) {
    throw new ValidationError("The amounts are too large", [
      { path: "lines", message: "The amounts are too large" },
    ]);
  }
  return v;
}

/** Quantities have at most two decimals; this is the quantity in hundredths. */
export function hundredths(quantity: number): bigint {
  return BigInt(Math.round(quantity * 100));
}

/** Quantity × unit price, rounded half away from zero to a whole minor unit. */
export function lineNet(quantity: number, unitPriceMinor: number): number {
  return toSafe(divRound(hundredths(quantity) * BigInt(unitPriceMinor), 100n));
}

/** Tax on an amount at a rate in basis points, rounded half away from zero. */
export function taxOn(amountMinor: number, rateBps: number): number {
  return toSafe(divRound(BigInt(amountMinor) * BigInt(rateBps), B10K));
}

/** A unit cost with a markup in basis points (EXP-04): cost × (1 + markup), rounded half away from zero. */
export function markedUp(unitCostMinor: number, markupBps: number): number {
  return toSafe(divRound(BigInt(unitCostMinor) * (B10K + BigInt(markupBps)), B10K));
}

/**
 * The document discount in minor units: a percentage (basis points) of the subtotal, rounded half away from zero,
 * or a fixed amount. Never more than the subtotal and never negative.
 */
export function discountAmount(
  subtotalMinor: number,
  type: DiscountType | null | undefined,
  value: number,
): number {
  if (!type || value <= 0 || subtotalMinor <= 0) return 0;
  const raw = type === "percent" ? taxOn(subtotalMinor, Math.min(value, 10_000)) : value;
  return Math.min(raw, subtotalMinor);
}

/**
 * Splits `amount` across lines in proportion to their weights with the largest-remainder method, so the parts
 * always add up to the amount exactly. Ties go to the earlier line. All-zero weights get nothing.
 */
export function allocate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, w) => a + BigInt(w), 0n);
  if (total <= 0n || amount === 0) return weights.map(() => 0);
  const a = BigInt(amount);
  const parts = weights.map((w) => (a * BigInt(w)) / total);
  const remainders = weights.map((w, i) => ({ i, r: (a * BigInt(w)) % total }));
  let left = a - parts.reduce((x, p) => x + p, 0n);
  remainders.sort((x, y) => (y.r > x.r ? 1 : y.r < x.r ? -1 : x.i - y.i));
  for (const { i } of remainders) {
    if (left <= 0n) break;
    parts[i]! += 1n;
    left -= 1n;
  }
  return parts.map(toSafe);
}

export interface LineAmounts {
  quantity: number;
  unitPriceMinor: number;
  taxRateBps: number;
}

export interface ComputedLine {
  netMinor: number;
  /** This line's share of the document discount. */
  discountMinor: number;
  taxMinor: number;
}

export interface DocumentTotals {
  lines: ComputedLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Totals of a quote or invoice: each line's net (quantity × unit price), the subtotal, the document discount
 * (capped at the subtotal) allocated to the lines in proportion to their net, each line's tax on its net after
 * the discount, and total = subtotal − discount + tax.
 */
export function computeTotals(
  lines: readonly LineAmounts[],
  discount: { type: DiscountType | null | undefined; value: number } = { type: null, value: 0 },
): DocumentTotals {
  const nets = lines.map((l) => lineNet(l.quantity, l.unitPriceMinor));
  const subtotalMinor = toSafe(nets.reduce((a, n) => a + BigInt(n), 0n));
  const discountMinor = discountAmount(subtotalMinor, discount.type, discount.value);
  const shares = allocate(discountMinor, nets);
  const computed = lines.map((l, i) => {
    const netMinor = nets[i]!;
    const discountShare = shares[i]!;
    return {
      netMinor,
      discountMinor: discountShare,
      taxMinor: taxOn(netMinor - discountShare, l.taxRateBps),
    };
  });
  const taxMinor = toSafe(computed.reduce((a, l) => a + BigInt(l.taxMinor), 0n));
  return {
    lines: computed,
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor: toSafe(BigInt(subtotalMinor) - BigInt(discountMinor) + BigInt(taxMinor)),
  };
}

/** The organization's default tax rate: the `taxRates` entry marked default, else none. */
export function defaultTaxRate(taxRates: readonly { rate_bps: number; default: boolean }[]): number {
  return taxRates.find((r) => r.default)?.rate_bps ?? 0;
}

// ------------------------------------------------------------------ labor (FIN-03)

/** Labor is billed in quarter hours. */
export const LABOR_INCREMENT_MIN = 15;

/**
 * Billable hours for recorded work minutes: rounded up to the next quarter hour, so 1 h 05 min bills 1.25 h and
 * any recorded work bills at least 0.25 h. Zero minutes bill nothing.
 */
export function billableHours(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(Math.round(minutes) / LABOR_INCREMENT_MIN) / (60 / LABOR_INCREMENT_MIN);
}

// ------------------------------------------------------------------ quote lifecycle (FIN-02)

/**
 * draft → sent → approved | declined | expired. A sent or expired quote can go back to draft to be revised
 * ("revise"); the customer can't decide on it until it is sent again. Approved and declined are final: start
 * from a duplicate instead.
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["approved", "declined", "expired", "draft"],
  expired: ["draft"],
  approved: [],
  declined: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!canTransitionQuote(from, to)) {
    throw new ConflictError(`A ${from} quote can't become ${to}`, { from, to });
  }
}

/** Only drafts can be edited; revise a sent quote first. */
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === "draft";
}

/** A sent quote past its validity date (a local date of the organization) is expired. */
export function isQuoteExpired(
  q: { status: QuoteStatus; validUntil: string | null },
  today: string,
): boolean {
  return q.status === "sent" && q.validUntil !== null && q.validUntil < today;
}

// ------------------------------------------------------------------ invoice lifecycle (FIN-03)

/**
 * draft → sent (issued: numbered and dated) → paid once payments cover the total; a sent invoice past its due
 * date with a balance becomes overdue (worker) and still becomes paid when settled. Drafts and unpaid invoices
 * without payments can be voided with a reason; an invoice with payments can't be voided.
 */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["sent", "void"],
  sent: ["paid", "overdue", "void"],
  overdue: ["paid", "void"],
  paid: [],
  void: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return status === "draft";
}

/** Issued and not settled or void: payments can be recorded and reminders sent. */
export function isInvoiceOpen(status: InvoiceStatus): boolean {
  return status === "sent" || status === "overdue";
}

/** Total minus payments, never negative. */
export function balanceOf(inv: { totalMinor: number; amountPaidMinor: number }): number {
  return Math.max(0, inv.totalMinor - inv.amountPaidMinor);
}

/** Why an invoice can't be voided, or null when it can. */
export function voidBlocker(inv: {
  status: InvoiceStatus;
  amountPaidMinor: number;
}): "already_void" | "paid" | "has_payments" | null {
  if (inv.status === "void") return "already_void";
  if (inv.status === "paid") return "paid";
  if (inv.amountPaidMinor > 0) return "has_payments";
  return null;
}

/** A sent invoice past its due date with a balance left is overdue (dates are local to the organization). */
export function isPastDue(
  inv: { status: InvoiceStatus; dueDate: string | null; totalMinor: number; amountPaidMinor: number },
  today: string,
): boolean {
  return isInvoiceOpen(inv.status) && inv.dueDate !== null && inv.dueDate < today && balanceOf(inv) > 0;
}

/** Whole days between two local dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The reminder stages (days after the due date) that are due today and not sent yet (FIN-06). */
export function dueReminderStages(
  dueDate: string,
  today: string,
  stages: readonly number[],
  sent: readonly number[],
): number[] {
  const late = daysBetween(dueDate, today);
  return stages.filter((s) => late >= s && !sent.includes(s));
}
