import { describe, expect, it } from "vitest";
import { addMoney, CURRENCY_INFO, formatMoney, money, multiplyMoney, parseMajor, taxFor, toMajor } from "./money";

describe("money", () => {
  it("adds amounts of the same currency", () => {
    expect(addMoney(money(1050, "USD"), money(250, "USD"))).toEqual({ amountMinor: 1300, currency: "USD" });
  });

  it("refuses to add different currencies", () => {
    expect(() => addMoney(money(1, "USD"), money(1, "IDR"))).toThrow(/Currency mismatch/);
  });

  it("guards the safe integer range", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow(RangeError);
    expect(() => money(1.5, "USD")).toThrow(RangeError);
  });

  it("rounds half away from zero when multiplying", () => {
    expect(multiplyMoney(money(5, "USD"), 0.5).amountMinor).toBe(3); // 2.5 → 3
    expect(multiplyMoney(money(-5, "USD"), 0.5).amountMinor).toBe(-3); // -2.5 → -3
    expect(multiplyMoney(money(333, "USD"), 3).amountMinor).toBe(999);
    expect(multiplyMoney(money(1999, "USD"), 1.5).amountMinor).toBe(2999); // 2998.5 → 2999
  });

  it("computes tax in basis points", () => {
    expect(taxFor(money(10000, "USD"), 825).amountMinor).toBe(825); // 8.25% of $100
    expect(taxFor(money(12900, "USD"), 825).amountMinor).toBe(1064); // 1064.25 → 1064
    expect(taxFor(money(8_500_000, "IDR"), 1200).amountMinor).toBe(1_020_000); // PPN 12% of Rp85.000
    expect(taxFor(money(100, "USD"), 0).amountMinor).toBe(0);
  });

  it("converts to major units", () => {
    expect(toMajor(12950, "USD")).toBe(129.5);
    expect(toMajor(8_500_000, "IDR")).toBe(85_000);
  });

  it("parses user input", () => {
    expect(parseMajor("1,250.50", "USD")).toBe(125050);
    expect(parseMajor("129", "USD")).toBe(12900);
    expect(parseMajor(" 0.5 ", "USD")).toBe(50);
    expect(parseMajor("-12.30", "USD")).toBe(-1230);
    expect(parseMajor("150000", "IDR")).toBe(15_000_000);
    expect(parseMajor("1.234", "USD")).toBeNull(); // too many decimals
    expect(parseMajor("abc", "USD")).toBeNull();
    expect(parseMajor("", "USD")).toBeNull();
    expect(parseMajor("1e5", "USD")).toBeNull();
    expect(parseMajor("99999999999999999999", "USD")).toBeNull();
  });

  it("formats USD with cents and IDR without", () => {
    expect(formatMoney(money(129050, "USD"))).toBe("$1,290.50");
    expect(formatMoney(money(8_500_000, "IDR")).replace(/\s/g, " ")).toBe("Rp 85.000");
    expect(formatMoney(money(129050, "USD"), "en-GB")).toBe("US$1,290.50");
  });

  it("describes both supported currencies", () => {
    expect(CURRENCY_INFO.USD.displayDigits).toBe(2);
    expect(CURRENCY_INFO.IDR.displayDigits).toBe(0);
  });
});
