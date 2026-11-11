import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dateFnsLocale,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatDay,
  formatNumber,
  formatRelative,
  formatTime,
  formatWindow,
  intlLocale,
} from "./format";

// SET-05: English reads month-first with a 12-hour clock; Bahasa Indonesia day-first with a 24-hour clock (14.30).
const TZ = "Asia/Jakarta";
const at = "2026-05-07T07:30:00Z"; // Thu 7 May 2026, 14:30 in Jakarta

describe("date formatting", () => {
  it("formats dates and times in English by default", () => {
    expect(formatDateTime(at, TZ)).toBe("May 7, 2026 · 2:30 PM");
    expect(formatDate(at, TZ, "en")).toBe("May 7, 2026");
    expect(formatTime(at, TZ, "en")).toBe("2:30 PM");
    expect(formatDay(at, TZ, "en")).toBe("Thursday, May 7");
    expect(formatWindow(at, "2026-05-07T09:00:00Z", TZ, "en")).toBe("Thu, May 7 · 2:30 PM – 4:00 PM");
    expect(formatWindow(at, "2026-05-08T09:00:00Z", TZ, "en")).toBe("May 7, 2:30 PM – May 8, 4:00 PM");
  });

  it("formats dates and times in Bahasa Indonesia", () => {
    expect(formatDateTime(at, TZ, "id")).toBe("7 Mei 2026 · 14.30");
    expect(formatDate(at, TZ, "id")).toBe("7 Mei 2026");
    expect(formatTime(at, TZ, "id")).toBe("14.30");
    expect(formatDay(at, TZ, "id")).toBe("Kamis, 7 Mei");
    expect(formatWindow(at, "2026-05-07T09:00:00Z", TZ, "id")).toBe("Kam, 7 Mei · 14.30 – 16.00");
    expect(formatWindow(at, "2026-05-08T09:00:00Z", TZ, "id")).toBe("7 Mei, 14.30 – 8 Mei, 16.00");
  });

  it("shows a dash for missing values and reads unknown locales as English", () => {
    expect(formatDateTime(null, TZ, "id")).toBe("—");
    expect(formatDate(undefined, TZ)).toBe("—");
    expect(formatWindow(null, at, TZ)).toBe("—");
    expect(formatDate(at, TZ, "fr")).toBe("May 7, 2026");
  });

  it("formats calendar dates without a time zone", () => {
    expect(formatCalendarDate("2026-11-15", "weekday", "en")).toBe("Sun");
    expect(formatCalendarDate("2026-11-15", "weekdayLong", "id")).toBe("Minggu");
    expect(formatCalendarDate("2026-08-17", "monthDay", "en")).toBe("Aug 17");
    expect(formatCalendarDate("2026-08-17", "monthDay", "id")).toBe("17 Agt");
    expect(formatCalendarDate("2026-08-17", "weekdayMonthDay", "id")).toBe("Senin 17 Agt");
    expect(formatCalendarDate("2026-08-17", "date", "id")).toBe("17 Agt 2026");
  });

  describe("relative times", () => {
    beforeEach(() => vi.useFakeTimers({ now: new Date("2026-05-07T10:30:00Z") }));
    afterEach(() => vi.useRealTimers());

    it("reads in the locale", () => {
      expect(formatRelative(at, "en")).toBe("3 hours ago");
      expect(formatRelative(at, "id")).toBe("3 jam yang lalu");
      expect(formatRelative(new Date("2026-05-09T10:30:00Z"))).toBe("in 2 days");
    });
  });
});

describe("numbers", () => {
  it("group digits by locale", () => {
    expect(formatNumber(1250.5, "en")).toBe("1,250.5");
    expect(formatNumber(1250.5, "id")).toBe("1.250,5");
    expect(intlLocale("id")).toBe("id-ID");
    expect(intlLocale(undefined)).toBe("en-US");
    expect(dateFnsLocale("id").code).toBe("id");
  });
});
