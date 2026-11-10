import { describe, expect, it } from "vitest";
import {
  addMonths,
  daysInMonth,
  hasEnded,
  indexOnOrAfter,
  nextOccurrence,
  occurrenceAfter,
  occurrenceAt,
  occurrencesBetween,
  upcomingOccurrences,
  type RecurrenceRule,
} from "./recurrence";

const rule = (
  unit: RecurrenceRule["unit"],
  count: number,
  startsOn: string,
  endsOn: string | null = null,
) => ({
  unit,
  count,
  startsOn,
  endsOn,
});

describe("calendar helpers", () => {
  it("knows month lengths, leap years included", () => {
    expect([daysInMonth(2026, 1), daysInMonth(2028, 1), daysInMonth(2100, 1), daysInMonth(2000, 1)]).toEqual([
      28, 29, 28, 29,
    ]);
    expect(daysInMonth(2026, 0)).toBe(31);
    expect(daysInMonth(2026, 3)).toBe(30);
  });

  it("adds months with the day clamped to a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-10-31", 2)).toBe("2026-12-31");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(() => addMonths("2026-1-1", 1)).toThrow(RangeError);
  });
});

describe("occurrences (JOB-13)", () => {
  it("never drifts at month ends: Jan 31 monthly gives Feb 28, then Mar 31", () => {
    const r = rule("month", 1, "2026-01-31");
    expect([0, 1, 2, 3, 4].map((n) => occurrenceAt(r, n))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    // Leap year: Feb 29.
    expect(occurrenceAt(rule("month", 1, "2028-01-31"), 1)).toBe("2028-02-29");
  });

  it("handles Feb 29 yearly and quarterly plans", () => {
    const leap = rule("year", 1, "2028-02-29");
    expect([0, 1, 2, 3, 4].map((n) => occurrenceAt(leap, n))).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
    const quarterly = rule("month", 3, "2026-11-30");
    expect(upcomingOccurrences(quarterly, "2026-11-01", 4)).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-05-30",
      "2027-08-30",
    ]);
    expect(occurrenceAt(rule("year", 2, "2026-06-15"), 3)).toBe("2032-06-15");
  });

  it("counts days and weeks from the start", () => {
    expect(occurrenceAt(rule("day", 10, "2026-12-25"), 1)).toBe("2027-01-04");
    expect(upcomingOccurrences(rule("week", 2, "2026-11-02"), "2026-11-10", 3)).toEqual([
      "2026-11-16",
      "2026-11-30",
      "2026-12-14",
    ]);
  });

  it("finds the first occurrence on or after a date", () => {
    const weekly = rule("week", 1, "2026-11-02");
    expect(indexOnOrAfter(weekly, "2026-10-01")).toBe(0);
    expect(indexOnOrAfter(weekly, "2026-11-02")).toBe(0);
    expect(indexOnOrAfter(weekly, "2026-11-03")).toBe(1);
    expect(indexOnOrAfter(weekly, "2026-11-09")).toBe(1);
    const monthly = rule("month", 1, "2026-01-31");
    expect(indexOnOrAfter(monthly, "2026-02-28")).toBe(1);
    expect(indexOnOrAfter(monthly, "2026-03-01")).toBe(2);
    expect(indexOnOrAfter(monthly, "2026-03-31")).toBe(2);
    expect(indexOnOrAfter(rule("month", 6, "2026-05-31"), "2026-11-30")).toBe(1);
    expect(indexOnOrAfter(rule("month", 6, "2026-05-31"), "2026-12-01")).toBe(2);
  });

  it("stops at the end date, which is inclusive", () => {
    const r = rule("month", 1, "2026-01-15", "2026-04-15");
    expect(occurrencesBetween(r, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
    ]);
    expect(nextOccurrence(r, "2026-04-15")).toBe("2026-04-15");
    expect(nextOccurrence(r, "2026-04-16")).toBeNull();
    expect(upcomingOccurrences(r, "2026-03-01", 5)).toEqual(["2026-03-15", "2026-04-15"]);
    expect(occurrencesBetween(r, "2026-02-16", "2026-03-14")).toEqual([]);
  });

  it("continues after covered dates, past the end once the plan has ended", () => {
    const r = rule("month", 1, "2026-01-31", "2026-03-31");
    expect(occurrenceAfter(r, "2026-02-28")).toBe("2026-03-31");
    expect(occurrenceAfter(r, "2026-03-31")).toBe("2026-04-30");
    expect(hasEnded(r, "2026-03-31")).toBe(false);
    expect(hasEnded(r, "2026-04-30")).toBe(true);
    expect(hasEnded(rule("day", 1, "2026-01-01"), "2099-01-01")).toBe(false);
  });

  it("lists daily plans across a year and caps long lists", () => {
    const daily = rule("day", 1, "2026-01-01");
    expect(occurrencesBetween(daily, "2026-01-01", "2026-12-31")).toHaveLength(365);
    expect(occurrencesBetween(daily, "2026-01-01", "2030-12-31")).toHaveLength(1000);
    expect(upcomingOccurrences(daily, "2026-01-01", 5000)).toHaveLength(1000);
  });
});
