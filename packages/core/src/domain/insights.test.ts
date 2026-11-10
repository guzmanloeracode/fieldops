import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketStarts,
  daysInclusive,
  localDateString,
  monthStart,
  resolveDateRange,
  weekStart,
  weekdayOf,
  workingMinutesBetween,
  workingMinutesOn,
} from "./date-range";
import { warrantyStatus } from "./equipment";
import { metResolutionTarget, responseDeadline, riskOf } from "./risk";

describe("date math", () => {
  it("reads the local date of an instant in a time zone", () => {
    const instant = new Date("2026-11-10T03:30:00Z");
    expect(localDateString(instant, "America/Chicago")).toBe("2026-11-09");
    expect(localDateString(instant, "Asia/Jakarta")).toBe("2026-11-10");
  });

  it("adds days across months and years and counts inclusive days", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysInclusive("2026-11-01", "2026-11-30")).toBe(30);
    expect(daysInclusive("2026-11-10", "2026-11-10")).toBe(1);
    expect(() => addDays("10/11/2026", 1)).toThrow(RangeError);
  });

  it("finds weekdays, ISO week starts and month starts", () => {
    expect(weekdayOf("2026-11-10")).toBe(2); // Tuesday
    expect(weekStart("2026-11-10")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday belongs to the week before
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(monthStart("2026-11-10")).toBe("2026-11-01");
  });
});

describe("resolveDateRange (DSH-03)", () => {
  const today = "2026-11-10";
  it("rolling presets end today and compare with the equal period before", () => {
    expect(resolveDateRange({ range: "7d" }, today)).toEqual({
      from: "2026-11-04",
      to: today,
      prevFrom: "2026-10-28",
      prevTo: "2026-11-03",
      days: 7,
      bucket: "day",
    });
    expect(resolveDateRange({ range: "30d" }, today)).toMatchObject({ from: "2026-10-12", days: 30 });
    expect(resolveDateRange({ range: "90d" }, today)).toMatchObject({
      from: "2026-08-13",
      prevTo: "2026-08-12",
      bucket: "week",
    });
  });

  it("month to date and the whole last month", () => {
    expect(resolveDateRange({ range: "month" }, today)).toMatchObject({
      from: "2026-11-01",
      to: today,
      prevFrom: "2026-10-22",
      prevTo: "2026-10-31",
    });
    expect(resolveDateRange({ range: "last_month" }, "2026-03-15")).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
      days: 28,
      prevFrom: "2026-01-04",
    });
  });

  it("uses a valid custom range and falls back to 30 days otherwise", () => {
    expect(resolveDateRange({ range: "custom", from: "2026-01-01", to: "2026-06-30" }, today)).toMatchObject({
      from: "2026-01-01",
      to: "2026-06-30",
      bucket: "week",
      days: 181,
    });
    const fallback = { from: "2026-10-12", to: today };
    expect(resolveDateRange({ range: "custom" }, today)).toMatchObject(fallback);
    expect(resolveDateRange({ range: "custom", from: "2026-11-10", to: "2026-11-01" }, today)).toMatchObject(
      fallback,
    );
    expect(resolveDateRange({ range: "custom", from: "2024-01-01", to: "2026-01-01" }, today)).toMatchObject(
      fallback,
    );
  });

  it("lists every bucket, including empty ones", () => {
    expect(bucketStarts("2026-11-08", "2026-11-10", "day")).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
    ]);
    expect(bucketStarts("2026-11-04", "2026-11-17", "week")).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
  });
});

describe("working minutes", () => {
  const hours = [
    { day: 1, open: "08:00", close: "12:00" },
    { day: 1, open: "13:00", close: "17:00" },
    { day: 2, open: "08:00", close: "17:00" },
    { day: 3, open: "17:00", close: "08:00" }, // nonsense blocks count as zero
  ];
  it("adds up the blocks of a weekday", () => {
    expect(workingMinutesOn(hours, "2026-11-09")).toBe(480); // Monday
    expect(workingMinutesOn(hours, "2026-11-10")).toBe(540);
    expect(workingMinutesOn(hours, "2026-11-11")).toBe(0);
    expect(workingMinutesOn([], "2026-11-09")).toBe(0);
  });
  it("adds up a range", () => {
    expect(workingMinutesBetween(hours, "2026-11-08", "2026-11-14")).toBe(1020);
    expect(workingMinutesBetween(hours, "2026-11-10", "2026-11-09")).toBe(0);
  });
});

describe("provisional risk rules (DSH-04)", () => {
  const created = new Date("2026-11-10T08:00:00Z");
  it("flags unscheduled jobs past their response target", () => {
    const job = { status: "new", priority: "urgent", createdAt: created, scheduledEnd: null } as const;
    expect(responseDeadline(job).toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(riskOf(job, new Date("2026-11-10T09:59:00Z"))).toBeNull();
    expect(riskOf(job, new Date("2026-11-10T10:01:00Z"))).toBe("response_overdue");
    const low = { ...job, priority: "low" } as const;
    expect(riskOf(low, new Date("2026-11-12T08:00:00Z"))).toBeNull();
  });

  it("flags open visits whose window has ended", () => {
    const end = new Date("2026-11-10T12:00:00Z");
    const later = new Date("2026-11-10T12:30:00Z");
    for (const status of ["scheduled", "en_route", "in_progress", "on_hold"] as const) {
      expect(riskOf({ status, priority: "normal", createdAt: created, scheduledEnd: end }, later)).toBe(
        "running_late",
      );
    }
    expect(
      riskOf({ status: "scheduled", priority: "normal", createdAt: created, scheduledEnd: end }, end),
    ).toBe(null);
    expect(
      riskOf({ status: "scheduled", priority: "normal", createdAt: created, scheduledEnd: null }, later),
    ).toBeNull();
    for (const status of ["completed", "canceled"] as const) {
      expect(riskOf({ status, priority: "urgent", createdAt: created, scheduledEnd: end }, later)).toBeNull();
    }
  });

  it("checks the resolution target per priority", () => {
    const job = { priority: "high", createdAt: created } as const;
    expect(metResolutionTarget(job, new Date("2026-11-13T08:00:00Z"))).toBe(true);
    expect(metResolutionTarget(job, new Date("2026-11-13T08:01:00Z"))).toBe(false);
  });
});

describe("warrantyStatus (CUS-03)", () => {
  it("classifies the warranty on a date", () => {
    expect(warrantyStatus(null, "2026-11-10")).toBe("unknown");
    expect(warrantyStatus("2026-11-09", "2026-11-10")).toBe("expired");
    expect(warrantyStatus("2026-11-10", "2026-11-10")).toBe("expiring");
    expect(warrantyStatus("2027-01-09", "2026-11-10")).toBe("expiring");
    expect(warrantyStatus("2027-01-10", "2026-11-10")).toBe("active");
  });
});
