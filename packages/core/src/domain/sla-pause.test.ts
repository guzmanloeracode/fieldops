import { describe, expect, it } from "vitest";
import type { WorkingHoursEntry } from "./availability";
import {
  elapsedMinutes,
  endSlaPause,
  pausesResolution,
  slaClockStart,
  slaDeadlines,
  withPausedMinutes,
} from "./sla";

// SLA-04: waiting for the customer pauses the resolution clock.

const d = (iso: string) => new Date(iso);
const weekdays = (open: string, close: string): WorkingHoursEntry[] =>
  [1, 2, 3, 4, 5].map((day) => ({ day, open, close }));
const CHICAGO = "America/Chicago";

describe("pausesResolution", () => {
  it("pauses only on hold for the customer", () => {
    expect(pausesResolution("on_hold", "customer")).toBe(true);
    expect(pausesResolution("on_hold", "parts")).toBe(false);
    expect(pausesResolution("on_hold", null)).toBe(false);
    expect(pausesResolution("in_progress", "customer")).toBe(false);
  });
});

describe("elapsedMinutes", () => {
  it("counts calendar minutes without hours, and nothing for an empty or reversed span", () => {
    expect(elapsedMinutes(d("2026-11-10T10:00:00Z"), d("2026-11-11T12:30:20Z"), [], CHICAGO)).toBe(1590);
    expect(elapsedMinutes(d("2026-11-10T10:00:00Z"), d("2026-11-10T10:00:00Z"), [], CHICAGO)).toBe(0);
    expect(elapsedMinutes(d("2026-11-10T10:00:00Z"), d("2026-11-10T09:00:00Z"), [], CHICAGO)).toBe(0);
  });

  it("counts only business minutes in the organization's time zone", () => {
    const hours = weekdays("08:00", "17:00");
    // Tuesday 16:00 → Wednesday 09:00 local: 1 h on Tuesday, 1 h on Wednesday.
    expect(elapsedMinutes(d("2026-11-10T22:00:00Z"), d("2026-11-11T15:00:00Z"), hours, CHICAGO)).toBe(120);
    // Friday 15:00 → Monday 10:00 local, over a weekend: 2 h + 2 h.
    expect(elapsedMinutes(d("2026-11-13T21:00:00Z"), d("2026-11-16T16:00:00Z"), hours, CHICAGO)).toBe(240);
    // Entirely outside business hours.
    expect(elapsedMinutes(d("2026-11-14T15:00:00Z"), d("2026-11-15T20:00:00Z"), hours, CHICAGO)).toBe(0);
    expect(() =>
      elapsedMinutes(d("2026-01-01T00:00:00Z"), d("2040-01-01T00:00:00Z"), hours, CHICAGO),
    ).toThrow(RangeError);
  });
});

describe("endSlaPause", () => {
  it("moves the resolution deadline by the calendar span", () => {
    const end = endSlaPause({
      pausedAt: d("2026-11-10T10:00:00Z"),
      now: d("2026-11-12T13:00:00Z"),
      pausedMinutes: 30,
      resolutionDueAt: d("2026-11-14T10:00:00Z"),
      resolutionAtRiskAt: d("2026-11-13T10:00:00Z"),
      businessHours: false,
      hours: weekdays("08:00", "17:00"),
      timeZone: CHICAGO,
    });
    expect(end).toEqual({
      minutes: 51 * 60,
      slaPausedMinutes: 51 * 60 + 30,
      resolutionDueAt: d("2026-11-16T13:00:00Z"),
      resolutionAtRiskAt: d("2026-11-15T13:00:00Z"),
    });
  });

  it("measures and shifts in business hours for a business-hours policy", () => {
    const end = endSlaPause({
      // Tuesday 16:00 → Wednesday 09:00 local: 120 business minutes.
      pausedAt: d("2026-11-10T22:00:00Z"),
      now: d("2026-11-11T15:00:00Z"),
      pausedMinutes: 0,
      // Due Friday 16:30 local → 2 business hours later is Monday 09:30.
      resolutionDueAt: d("2026-11-13T22:30:00Z"),
      resolutionAtRiskAt: null,
      businessHours: true,
      hours: weekdays("08:00", "17:00"),
      timeZone: CHICAGO,
    });
    expect(end.minutes).toBe(120);
    expect(end.resolutionDueAt).toEqual(d("2026-11-16T15:30:00Z"));
    expect(end.resolutionAtRiskAt).toBeNull();
  });

  it("leaves the deadlines alone for a pause of no measurable length", () => {
    const due = d("2026-11-14T10:00:00Z");
    const end = endSlaPause({
      pausedAt: d("2026-11-14T15:00:00Z"),
      now: d("2026-11-15T15:00:00Z"),
      pausedMinutes: 10,
      resolutionDueAt: due,
      resolutionAtRiskAt: due,
      businessHours: true,
      hours: weekdays("08:00", "17:00"),
      timeZone: CHICAGO,
    });
    expect(end).toEqual({ minutes: 0, slaPausedMinutes: 10, resolutionDueAt: due, resolutionAtRiskAt: due });
  });
});

describe("withPausedMinutes", () => {
  const deadlines = slaDeadlines({
    createdAt: d("2026-11-10T10:00:00Z"),
    policy: { responseMin: 60, resolutionMin: 600, businessHours: false },
    businessHours: [],
    timeZone: CHICAGO,
  });

  it("moves only the resolution deadline and its at-risk point", () => {
    const shifted = withPausedMinutes(deadlines, 90, { businessHours: false, hours: [], timeZone: CHICAGO });
    expect(shifted.responseDueAt).toEqual(deadlines.responseDueAt);
    expect(shifted.resolutionDueAt).toEqual(d("2026-11-10T21:30:00Z"));
    expect(shifted.resolutionAtRiskAt.getTime() - deadlines.resolutionAtRiskAt.getTime()).toBe(90 * 60_000);
    expect(withPausedMinutes(deadlines, 0, { businessHours: false, hours: [], timeZone: CHICAGO })).toBe(
      deadlines,
    );
  });

  it("counts business minutes for a business-hours policy", () => {
    const shifted = withPausedMinutes(deadlines, 60, {
      businessHours: true,
      hours: weekdays("08:00", "17:00"),
      timeZone: CHICAGO,
    });
    // Due Tuesday 14:00 local + 1 business hour → 15:00 local.
    expect(shifted.resolutionDueAt).toEqual(d("2026-11-10T21:00:00Z"));
  });
});

describe("slaClockStart", () => {
  it("starts at creation, or on the visit date for a job generated ahead of time", () => {
    const createdAt = d("2026-11-10T15:00:00Z");
    expect(slaClockStart({ createdAt, occurrenceDate: null }, CHICAGO)).toBe(createdAt);
    // Midnight on the visit date in Chicago (CST, UTC-6).
    expect(slaClockStart({ createdAt, occurrenceDate: "2026-11-20" }, CHICAGO)).toEqual(
      d("2026-11-20T06:00:00Z"),
    );
    // Generated on the visit date itself: the creation time is later than midnight.
    expect(slaClockStart({ createdAt, occurrenceDate: "2026-11-10" }, CHICAGO)).toBe(createdAt);
  });
});
