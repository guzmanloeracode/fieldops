import { describe, expect, it } from "vitest";
import {
  dayOfWeek,
  describeHours,
  effectiveHours,
  hhmmToMinutes,
  isWithinWorkingHours,
  localDateOf,
  localMinutesOf,
  missingSkills,
  overlappingTimeOff,
  rangesOverlap,
  shiftDate,
  snapToMinutes,
  tzOffsetMs,
  workingWindows,
  zonedInstant,
  type WorkingHoursEntry,
} from "./availability";

const CHI = "America/Chicago";
const WEEKDAYS: WorkingHoursEntry[] = [1, 2, 3, 4, 5].map((day) => ({ day, open: "08:00", close: "17:00" }));
const at = (s: string) => new Date(s);

describe("time zone helpers", () => {
  it("knows the offset on both sides of daylight saving time", () => {
    expect(tzOffsetMs(Date.parse("2026-07-01T12:00:00Z"), CHI)).toBe(-5 * 3_600_000);
    expect(tzOffsetMs(Date.parse("2026-11-11T12:00:00.250Z"), CHI)).toBe(-6 * 3_600_000);
    expect(tzOffsetMs(Date.parse("2026-11-11T12:00:00Z"), "UTC")).toBe(0);
  });

  it("converts a local wall-clock time to an instant, including DST change days", () => {
    expect(zonedInstant("2026-11-11", 8 * 60, CHI).toISOString()).toBe("2026-11-11T14:00:00.000Z");
    expect(zonedInstant("2026-07-01", 8 * 60, CHI).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    // Clocks fall back at 02:00 on 1 Nov 2026; 08:00 that day is already CST.
    expect(zonedInstant("2026-11-01", 8 * 60, CHI).toISOString()).toBe("2026-11-01T14:00:00.000Z");
    // Clocks spring forward on 8 Mar 2026; 08:00 that day is CDT.
    expect(zonedInstant("2026-03-08", 8 * 60, CHI).toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(zonedInstant("2026-11-11", 0, "Asia/Jakarta").toISOString()).toBe("2026-11-10T17:00:00.000Z");
  });

  it("reads the local date and minutes of an instant", () => {
    expect(localDateOf(at("2026-11-11T03:00:00Z"), CHI)).toBe("2026-11-10");
    expect(localDateOf(at("2026-11-11T17:30:00Z"), "Asia/Jakarta")).toBe("2026-11-12");
    expect(localMinutesOf(at("2026-11-11T14:45:00Z"), CHI)).toBe(8 * 60 + 45);
  });

  it("does calendar arithmetic on plain dates", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayOfWeek("2026-11-11")).toBe(3);
    expect(() => dayOfWeek("11/11/2026")).toThrow(RangeError);
    expect(hhmmToMinutes("08:30")).toBe(510);
    expect(hhmmToMinutes("17")).toBe(17 * 60);
  });

  it("snaps to the nearest quarter hour", () => {
    expect(snapToMinutes(at("2026-11-11T14:07:00Z")).toISOString()).toBe("2026-11-11T14:00:00.000Z");
    expect(snapToMinutes(at("2026-11-11T14:08:00Z")).toISOString()).toBe("2026-11-11T14:15:00.000Z");
    expect(snapToMinutes(at("2026-11-11T14:20:00Z"), 30).toISOString()).toBe("2026-11-11T14:30:00.000Z");
  });
});

describe("working hours", () => {
  it("falls back to the business hours", () => {
    expect(effectiveHours(null, WEEKDAYS)).toEqual(WEEKDAYS);
    const own = [{ day: 6, open: "09:00", close: "13:00" }];
    expect(effectiveHours(own, WEEKDAYS)).toEqual(own);
  });

  it("lists the windows of one local day, ignoring empty ones", () => {
    const split: WorkingHoursEntry[] = [
      { day: 3, open: "13:00", close: "17:00" },
      { day: 3, open: "08:00", close: "12:00" },
      { day: 3, open: "18:00", close: "18:00" },
    ];
    expect(workingWindows(split, "2026-11-11", CHI).map((w) => w.start.toISOString())).toEqual([
      "2026-11-11T14:00:00.000Z",
      "2026-11-11T19:00:00.000Z",
    ]);
    expect(workingWindows(split, "2026-11-12", CHI)).toEqual([]);
  });

  it("checks that a visit fits in one window", () => {
    const visit = (from: string, to: string) => ({ start: at(from), end: at(to) });
    expect(isWithinWorkingHours(WEEKDAYS, visit("2026-11-11T14:00:00Z", "2026-11-11T16:00:00Z"), CHI)).toBe(
      true,
    );
    expect(isWithinWorkingHours(WEEKDAYS, visit("2026-11-11T22:00:00Z", "2026-11-12T00:00:00Z"), CHI)).toBe(
      false,
    );
    expect(isWithinWorkingHours(WEEKDAYS, visit("2026-11-11T13:00:00Z", "2026-11-11T15:00:00Z"), CHI)).toBe(
      false,
    );
    // Saturday is a day off.
    expect(isWithinWorkingHours(WEEKDAYS, visit("2026-11-14T15:00:00Z", "2026-11-14T16:00:00Z"), CHI)).toBe(
      false,
    );
    // No hours configured anywhere: no restriction.
    expect(isWithinWorkingHours([], visit("2026-11-14T03:00:00Z", "2026-11-14T04:00:00Z"), CHI)).toBe(true);
  });

  it("describes a day's hours", () => {
    expect(describeHours(WEEKDAYS, "2026-11-11")).toBe("08:00–17:00");
    expect(
      describeHours(
        [
          { day: 3, open: "13:00", close: "17:00" },
          { day: 3, open: "08:00", close: "12:00" },
        ],
        "2026-11-11",
      ),
    ).toBe("08:00–12:00, 13:00–17:00");
    expect(describeHours(WEEKDAYS, "2026-11-15")).toBeNull();
  });
});

describe("time off and skills", () => {
  it("finds overlapping time off", () => {
    const off = [
      { id: "a", startsAt: at("2026-11-11T00:00:00Z"), endsAt: at("2026-11-12T00:00:00Z") },
      { id: "b", startsAt: at("2026-11-12T00:00:00Z"), endsAt: at("2026-11-13T00:00:00Z") },
    ];
    const visit = { start: at("2026-11-11T22:00:00Z"), end: at("2026-11-12T00:00:00Z") };
    expect(overlappingTimeOff(off, visit).map((o) => o.id)).toEqual(["a"]);
    expect(rangesOverlap(visit, { start: at("2026-11-12T00:00:00Z"), end: at("2026-11-12T01:00:00Z") })).toBe(
      false,
    );
  });

  it("lists missing skills case-insensitively and once", () => {
    expect(missingSkills(["AC", "refrigerant", "refrigerant"], ["ac"])).toEqual(["refrigerant"]);
    expect(missingSkills([], [])).toEqual([]);
  });
});
