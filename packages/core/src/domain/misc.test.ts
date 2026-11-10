import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone } from "./contact";
import { decodeCursor, encodeCursor, parseSort } from "./cursor";
import {
  ConflictError,
  DemoRestrictedError,
  DomainError,
  ForbiddenError,
  HTTP_STATUS,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "./errors";
import { formatJobNumber, formatYearlyNumber, parseJobNumber } from "./numbering";
import { comparePriority, PRIORITY_LABELS, PRIORITY_RANK } from "./priority";
import { assertValidWindow, MAX_JOB_DURATION_MS, minutesBetween, overlaps } from "./schedule";
import { isValidSlug, slugify } from "./slug";

describe("numbering", () => {
  it("formats job numbers", () => {
    expect(formatJobNumber(123)).toBe("JOB-000123");
    expect(formatJobNumber(1234567)).toBe("JOB-1234567");
    expect(formatJobNumber(7, "WO")).toBe("WO-000007");
    expect(() => formatJobNumber(0)).toThrow(RangeError);
    expect(() => formatJobNumber(1.5)).toThrow(RangeError);
  });
  it("formats yearly numbers", () => {
    expect(formatYearlyNumber("INV", 2026, 42)).toBe("INV-2026-0042");
    expect(() => formatYearlyNumber("INV", 2026, 0)).toThrow(RangeError);
  });
  it("parses job numbers in any common spelling", () => {
    expect(parseJobNumber("JOB-000123")).toBe(123);
    expect(parseJobNumber("job-123")).toBe(123);
    expect(parseJobNumber("job123")).toBe(123);
    expect(parseJobNumber(" 123 ")).toBe(123);
    expect(parseJobNumber("000")).toBeNull();
    expect(parseJobNumber("INV-1")).toBeNull();
    expect(parseJobNumber("abc")).toBeNull();
    expect(parseJobNumber("WO-9", "WO")).toBe(9);
  });
});

describe("contact normalization", () => {
  it("normalizes emails", () => {
    expect(normalizeEmail("  Olivia@Example.COM ")).toBe("olivia@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
  it("normalizes US phones", () => {
    expect(normalizePhone("(512) 555-0142")).toBe("15125550142");
    expect(normalizePhone("512.555.0142", "us")).toBe("15125550142");
    expect(normalizePhone("1 512 555 0142", "US")).toBe("15125550142");
    expect(normalizePhone("+1 (512) 555-0142", "ID")).toBe("15125550142");
  });
  it("normalizes Indonesian phones", () => {
    expect(normalizePhone("0812-3456-789", "ID")).toBe("628123456789");
    expect(normalizePhone("62 812 3456 789", "ID")).toBe("628123456789");
    expect(normalizePhone("812 3456 789", "ID")).toBe("628123456789");
    expect(normalizePhone("+62 812-3456-789", "US")).toBe("628123456789");
    expect(normalizePhone("0062 812 3456 789", "ID")).toBe("628123456789");
  });
  it("keeps digits for unknown countries and rejects short input", () => {
    expect(normalizePhone("020 7946 0958", "GB")).toBe("02079460958");
    expect(normalizePhone("12345", "US")).toBeNull();
    expect(normalizePhone("", "US")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("cursor", () => {
  it("round-trips a payload", () => {
    const c = encodeCursor({ s: "-created_at", v: ["2026-11-10T00:00:00.000Z", "abc"] });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c, "-created_at")).toEqual({
      s: "-created_at",
      v: ["2026-11-10T00:00:00.000Z", "abc"],
    });
  });
  it("rejects a cursor made for another sort, or garbage", () => {
    const c = encodeCursor({ s: "number", v: [1, "x"] });
    expect(() => decodeCursor(c, "-number")).toThrow(ValidationError);
    expect(() => decodeCursor("not-base64-json", "number")).toThrow(ValidationError);
    expect(() =>
      decodeCursor(Buffer.from('{"s":"number","v":"nope"}').toString("base64url"), "number"),
    ).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from("null").toString("base64url"), "number")).toThrow(ValidationError);
  });
  it("parses sort expressions", () => {
    expect(parseSort("-scheduled_start,number", ["number", "scheduled_start"] as const)).toEqual([
      { field: "scheduled_start", desc: true },
      { field: "number", desc: false },
    ]);
    expect(parseSort("", ["number"] as const)).toEqual([]);
    expect(() => parseSort("password", ["number"] as const)).toThrow(ValidationError);
  });
});

describe("slug", () => {
  it("slugifies names", () => {
    expect(slugify("Acme Air & Clean")).toBe("acme-air-clean");
    expect(slugify("  Café Ñandú  ")).toBe("cafe-nandu");
    expect(slugify("---")).toBe("");
    expect(slugify("x".repeat(60))).toHaveLength(48);
    expect(slugify(`${"a".repeat(47)} b`)).toBe("a".repeat(47));
  });
  it("validates slugs", () => {
    expect(isValidSlug("acme-air")).toBe(true);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("-acme")).toBe(false);
    expect(isValidSlug("acme-")).toBe(false);
    expect(isValidSlug("Acme")).toBe(false);
    expect(isValidSlug("portal")).toBe(false);
    expect(isValidSlug("a".repeat(49))).toBe(false);
  });
});

describe("schedule", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 10, h));
  it("accepts a normal window", () => {
    expect(() => assertValidWindow(at(9), at(11))).not.toThrow();
    expect(() => assertValidWindow(at(0), new Date(at(0).getTime() + MAX_JOB_DURATION_MS))).not.toThrow();
  });
  it("rejects invalid, reversed, empty and over-long windows", () => {
    expect(() => assertValidWindow(new Date("nope"), at(1))).toThrow(/Invalid date/);
    expect(() => assertValidWindow(at(11), at(9))).toThrow(/after start/);
    expect(() => assertValidWindow(at(9), at(9))).toThrow(ValidationError);
    expect(() => assertValidWindow(at(0), new Date(at(0).getTime() + MAX_JOB_DURATION_MS + 1))).toThrow(
      /24 hours/,
    );
  });
  it("detects overlaps (touching windows don't overlap)", () => {
    expect(overlaps({ start: at(9), end: at(11) }, { start: at(10), end: at(12) })).toBe(true);
    expect(overlaps({ start: at(9), end: at(11) }, { start: at(11), end: at(12) })).toBe(false);
    expect(overlaps({ start: at(9), end: at(17) }, { start: at(10), end: at(11) })).toBe(true);
  });
  it("counts minutes", () => {
    expect(minutesBetween(at(9), at(11))).toBe(120);
  });
});

describe("priority", () => {
  it("orders priorities", () => {
    expect(comparePriority("urgent", "low")).toBeGreaterThan(0);
    expect(comparePriority("normal", "high")).toBeLessThan(0);
    expect(comparePriority("high", "high")).toBe(0);
    expect(Object.keys(PRIORITY_RANK)).toEqual(Object.keys(PRIORITY_LABELS));
  });
});

describe("errors", () => {
  it("carry codes that map to HTTP statuses", () => {
    const cases: [DomainError, number][] = [
      [new NotFoundError("Job"), 404],
      [new ForbiddenError(), 403],
      [new ValidationError("bad", [{ path: "x", message: "y" }]), 422],
      [new ConflictError("dup", { a: 1 }), 409],
      [new PreconditionFailedError(), 412],
      [new DemoRestrictedError(), 403],
    ];
    for (const [err, status] of cases) {
      expect(err).toBeInstanceOf(DomainError);
      expect(HTTP_STATUS[err.code]).toBe(status);
    }
    expect(new NotFoundError("Job").message).toBe("Job not found");
    expect(new ValidationError("bad", [{ path: "x", message: "y" }]).fields).toEqual([
      { path: "x", message: "y" },
    ]);
    expect(HTTP_STATUS.invalid_transition).toBe(409);
  });
});
