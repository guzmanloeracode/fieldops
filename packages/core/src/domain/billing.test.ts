import { describe, expect, it } from "vitest";
import {
  allocate,
  assertQuoteTransition,
  balanceOf,
  billableHours,
  canTransitionInvoice,
  canTransitionQuote,
  computeTotals,
  daysBetween,
  defaultTaxRate,
  discountAmount,
  dueReminderStages,
  hundredths,
  isInvoiceEditable,
  isInvoiceOpen,
  isPastDue,
  isQuoteEditable,
  isQuoteExpired,
  lineNet,
  markedUp,
  taxOn,
  voidBlocker,
} from "./billing";
import { ConflictError, ValidationError } from "./errors";

describe("line amounts", () => {
  it("multiplies quantity by unit price and rounds half away from zero", () => {
    expect(lineNet(1, 18900)).toBe(18900);
    expect(lineNet(2.5, 1999)).toBe(4998); // 4997.5 → 4998
    expect(lineNet(0.25, 9500)).toBe(2375);
    expect(lineNet(0.33, 1)).toBe(0); // 0.33 → 0
    expect(lineNet(0.5, 1)).toBe(1); // 0.5 → 1
    expect(lineNet(1.5, 3)).toBe(5); // 4.5 → 5
    expect(lineNet(3, 0)).toBe(0);
  });

  it("keeps two-decimal quantities exact", () => {
    expect(hundredths(0.29)).toBe(29n);
    expect(hundredths(1.1)).toBe(110n);
    expect(lineNet(0.29, 100)).toBe(29);
  });

  it("handles large IDR amounts without losing precision", () => {
    // Rp 99,999,999.99 × 100,000 would overflow a double's exact range without BigInt.
    expect(lineNet(99_999.99, 9_999_999_999)).toBe(999_999_899_900_000);
  });

  it("refuses totals outside the safe integer range", () => {
    expect(() => lineNet(100_000, 100_000_000_00_000)).toThrow(ValidationError);
  });

  it("computes tax in basis points with half-away rounding", () => {
    expect(taxOn(10000, 825)).toBe(825);
    expect(taxOn(1, 5000)).toBe(1); // 0.5 → 1
    expect(taxOn(-1, 5000)).toBe(-1);
    expect(taxOn(999, 1200)).toBe(120); // 119.88
    expect(taxOn(0, 1200)).toBe(0);
  });

  it("applies a markup to a unit cost", () => {
    expect(markedUp(1000, 0)).toBe(1000);
    expect(markedUp(1000, 2000)).toBe(1200);
    expect(markedUp(333, 1500)).toBe(383); // 382.95
    expect(markedUp(150_000_00, 2500)).toBe(187_500_00);
  });
});

describe("discountAmount", () => {
  it("takes a percentage of the subtotal", () => {
    expect(discountAmount(10000, "percent", 1000)).toBe(1000);
    expect(discountAmount(999, "percent", 1500)).toBe(150); // 149.85
  });
  it("caps a fixed amount and 100%+ at the subtotal", () => {
    expect(discountAmount(5000, "amount", 7000)).toBe(5000);
    expect(discountAmount(5000, "percent", 10_000)).toBe(5000);
    expect(discountAmount(5000, "percent", 20_000)).toBe(5000);
  });
  it("is zero without a type, value or subtotal", () => {
    expect(discountAmount(5000, null, 100)).toBe(0);
    expect(discountAmount(5000, undefined, 100)).toBe(0);
    expect(discountAmount(5000, "amount", 0)).toBe(0);
    expect(discountAmount(0, "amount", 100)).toBe(0);
  });
});

describe("allocate", () => {
  it("splits in proportion and sums exactly", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 7])).toEqual([3, 7]);
    const parts = allocate(1001, [333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
  });
  it("gives the extra units to the largest remainders, ties to the earlier line", () => {
    // 5 × 1/3 = 1.67 each → 1,1,1 + 2 left → the first two lines.
    expect(allocate(5, [1, 1, 1])).toEqual([2, 2, 1]);
    // 7 split 1:2 → 2.33, 4.67 → remainders favour the second line.
    expect(allocate(7, [1, 2])).toEqual([2, 5]);
  });
  it("gives nothing when there is nothing to split or no weight", () => {
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(50, [0, 0])).toEqual([0, 0]);
    expect(allocate(50, [])).toEqual([]);
  });
  it("skips zero-weight lines", () => {
    expect(allocate(9, [0, 3, 0, 6])).toEqual([0, 3, 0, 6]);
  });
});

describe("computeTotals", () => {
  it("adds up a USD quote with one tax rate", () => {
    const t = computeTotals([
      { quantity: 1, unitPriceMinor: 18900, taxRateBps: 825 },
      { quantity: 2, unitPriceMinor: 2450, taxRateBps: 825 },
    ]);
    expect(t.subtotalMinor).toBe(23800);
    expect(t.discountMinor).toBe(0);
    expect(t.lines.map((l) => l.taxMinor)).toEqual([1559, 404]); // 1559.25, 404.25
    expect(t.taxMinor).toBe(1963);
    expect(t.totalMinor).toBe(25763);
  });

  it("allocates a percentage discount before tax with mixed rates", () => {
    const t = computeTotals(
      [
        { quantity: 1, unitPriceMinor: 10000, taxRateBps: 1000 },
        { quantity: 1, unitPriceMinor: 5000, taxRateBps: 0 },
      ],
      { type: "percent", value: 1000 },
    );
    expect(t.discountMinor).toBe(1500);
    expect(t.lines.map((l) => l.discountMinor)).toEqual([1000, 500]);
    expect(t.lines.map((l) => l.taxMinor)).toEqual([900, 0]);
    expect(t.totalMinor).toBe(15000 - 1500 + 900);
  });

  it("allocates an amount discount so the shares sum exactly", () => {
    const t = computeTotals(
      [
        { quantity: 1, unitPriceMinor: 1000, taxRateBps: 1100 },
        { quantity: 1, unitPriceMinor: 1000, taxRateBps: 1100 },
        { quantity: 1, unitPriceMinor: 1000, taxRateBps: 1100 },
      ],
      { type: "amount", value: 100 },
    );
    expect(t.lines.map((l) => l.discountMinor)).toEqual([34, 33, 33]);
    expect(t.lines.map((l) => l.taxMinor)).toEqual([106, 106, 106]); // 106.26, 106.37, 106.37
    expect(t.totalMinor).toBe(3000 - 100 + 318);
  });

  it("handles a 100% discount: nothing left to tax", () => {
    const t = computeTotals(
      [
        { quantity: 2, unitPriceMinor: 4999, taxRateBps: 825 },
        { quantity: 1, unitPriceMinor: 1, taxRateBps: 825 },
      ],
      { type: "percent", value: 10_000 },
    );
    expect(t.discountMinor).toBe(t.subtotalMinor);
    expect(t.taxMinor).toBe(0);
    expect(t.totalMinor).toBe(0);
  });

  it("caps an amount discount above the subtotal", () => {
    const t = computeTotals([{ quantity: 1, unitPriceMinor: 500, taxRateBps: 1200 }], {
      type: "amount",
      value: 900,
    });
    expect(t.discountMinor).toBe(500);
    expect(t.totalMinor).toBe(0);
  });

  it("returns zeros for a document without lines", () => {
    const t = computeTotals([], { type: "percent", value: 500 });
    expect(t).toEqual({ lines: [], subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 });
  });

  it("totals IDR with PPN 12% and rounding on each line", () => {
    const t = computeTotals(
      [
        { quantity: 1, unitPriceMinor: 350_000_00, taxRateBps: 1200 },
        { quantity: 1.5, unitPriceMinor: 150_000_00, taxRateBps: 1200 },
        { quantity: 3, unitPriceMinor: 33_333, taxRateBps: 1200 },
      ],
      { type: "percent", value: 500 },
    );
    expect(t.subtotalMinor).toBe(350_000_00 + 225_000_00 + 99_999);
    expect(t.lines.reduce((a, l) => a + l.discountMinor, 0)).toBe(t.discountMinor);
    expect(t.totalMinor).toBe(t.subtotalMinor - t.discountMinor + t.taxMinor);
  });

  it("rounds half away from zero at line level, not on the total", () => {
    // Three lines at 0.5 tax each: each rounds to 1 (total 3), not round(1.5) = 2.
    const t = computeTotals([1, 2, 3].map(() => ({ quantity: 1, unitPriceMinor: 5, taxRateBps: 1000 })));
    expect(t.taxMinor).toBe(3);
  });
});

describe("defaultTaxRate", () => {
  it("uses the rate marked default, else zero", () => {
    expect(
      defaultTaxRate([
        { rate_bps: 500, default: false },
        { rate_bps: 825, default: true },
      ]),
    ).toBe(825);
    expect(defaultTaxRate([{ rate_bps: 500, default: false }])).toBe(0);
    expect(defaultTaxRate([])).toBe(0);
  });
});

describe("billableHours", () => {
  it("rounds recorded minutes up to the next quarter hour", () => {
    expect(billableHours(0)).toBe(0);
    expect(billableHours(-5)).toBe(0);
    expect(billableHours(1)).toBe(0.25);
    expect(billableHours(15)).toBe(0.25);
    expect(billableHours(16)).toBe(0.5);
    expect(billableHours(60)).toBe(1);
    expect(billableHours(65)).toBe(1.25);
    expect(billableHours(134.4)).toBe(2.25);
  });
});

describe("quote lifecycle", () => {
  it("allows the documented transitions", () => {
    expect(canTransitionQuote("draft", "sent")).toBe(true);
    expect(canTransitionQuote("sent", "approved")).toBe(true);
    expect(canTransitionQuote("sent", "declined")).toBe(true);
    expect(canTransitionQuote("sent", "expired")).toBe(true);
    expect(canTransitionQuote("sent", "draft")).toBe(true);
    expect(canTransitionQuote("expired", "draft")).toBe(true);
    expect(canTransitionQuote("draft", "approved")).toBe(false);
    expect(canTransitionQuote("approved", "draft")).toBe(false);
    expect(canTransitionQuote("declined", "sent")).toBe(false);
  });
  it("throws a conflict for anything else", () => {
    expect(() => assertQuoteTransition("approved", "declined")).toThrow(ConflictError);
    expect(() => assertQuoteTransition("draft", "sent")).not.toThrow();
  });
  it("edits only drafts", () => {
    expect(isQuoteEditable("draft")).toBe(true);
    expect(isQuoteEditable("sent")).toBe(false);
  });
  it("expires sent quotes after their validity date", () => {
    expect(isQuoteExpired({ status: "sent", validUntil: "2026-11-09" }, "2026-11-10")).toBe(true);
    expect(isQuoteExpired({ status: "sent", validUntil: "2026-11-10" }, "2026-11-10")).toBe(false);
    expect(isQuoteExpired({ status: "sent", validUntil: null }, "2026-11-10")).toBe(false);
    expect(isQuoteExpired({ status: "draft", validUntil: "2026-01-01" }, "2026-11-10")).toBe(false);
  });
});

describe("invoice lifecycle", () => {
  it("allows the documented transitions", () => {
    expect(canTransitionInvoice("draft", "sent")).toBe(true);
    expect(canTransitionInvoice("sent", "overdue")).toBe(true);
    expect(canTransitionInvoice("overdue", "paid")).toBe(true);
    expect(canTransitionInvoice("paid", "void")).toBe(false);
    expect(canTransitionInvoice("void", "sent")).toBe(false);
  });
  it("knows editable and open invoices", () => {
    expect(isInvoiceEditable("draft")).toBe(true);
    expect(isInvoiceEditable("sent")).toBe(false);
    expect(isInvoiceOpen("sent")).toBe(true);
    expect(isInvoiceOpen("overdue")).toBe(true);
    expect(isInvoiceOpen("draft")).toBe(false);
    expect(isInvoiceOpen("paid")).toBe(false);
  });
  it("computes the balance", () => {
    expect(balanceOf({ totalMinor: 1000, amountPaidMinor: 400 })).toBe(600);
    expect(balanceOf({ totalMinor: 1000, amountPaidMinor: 1200 })).toBe(0);
  });
  it("voids only invoices without payments", () => {
    expect(voidBlocker({ status: "draft", amountPaidMinor: 0 })).toBeNull();
    expect(voidBlocker({ status: "sent", amountPaidMinor: 0 })).toBeNull();
    expect(voidBlocker({ status: "overdue", amountPaidMinor: 100 })).toBe("has_payments");
    expect(voidBlocker({ status: "paid", amountPaidMinor: 1000 })).toBe("paid");
    expect(voidBlocker({ status: "void", amountPaidMinor: 0 })).toBe("already_void");
  });
  it("finds invoices past due with a balance", () => {
    const inv = { status: "sent" as const, dueDate: "2026-11-01", totalMinor: 1000, amountPaidMinor: 0 };
    expect(isPastDue(inv, "2026-11-02")).toBe(true);
    expect(isPastDue(inv, "2026-11-01")).toBe(false);
    expect(isPastDue({ ...inv, amountPaidMinor: 1000 }, "2026-11-10")).toBe(false);
    expect(isPastDue({ ...inv, status: "draft" }, "2026-11-10")).toBe(false);
    expect(isPastDue({ ...inv, dueDate: null }, "2026-11-10")).toBe(false);
  });
});

describe("reminders", () => {
  it("counts days between local dates", () => {
    expect(daysBetween("2026-11-01", "2026-11-08")).toBe(7);
    expect(daysBetween("2026-03-01", "2026-02-27")).toBe(-2);
  });
  it("lists the stages due and not sent", () => {
    expect(dueReminderStages("2026-11-01", "2026-11-03", [3, 7, 14], [])).toEqual([]);
    expect(dueReminderStages("2026-11-01", "2026-11-04", [3, 7, 14], [])).toEqual([3]);
    expect(dueReminderStages("2026-11-01", "2026-11-09", [3, 7, 14], [3])).toEqual([7]);
    expect(dueReminderStages("2026-11-01", "2026-11-30", [3, 7, 14], [])).toEqual([3, 7, 14]);
    expect(dueReminderStages("2026-11-01", "2026-11-30", [3, 7, 14], [3, 7, 14])).toEqual([]);
  });
});
