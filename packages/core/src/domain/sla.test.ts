import { describe, expect, it } from "vitest";
import type { WorkingHoursEntry } from "./availability";
import {
  addBusinessMinutes,
  addBusinessMinutesEach,
  currentSla,
  defaultTargets,
  needsAttention,
  slaDeadlines,
  slaState,
  type SlaFacts,
} from "./sla";

const d = (iso: string) => new Date(iso);
const weekdays = (open: string, close: string): WorkingHoursEntry[] =>
  [1, 2, 3, 4, 5].map((day) => ({ day, open, close }));
const CHICAGO = "America/Chicago";
const JAKARTA = "Asia/Jakarta";

describe("addBusinessMinutes", () => {
  it("counts calendar time without usable hours", () => {
    expect(addBusinessMinutes(d("2026-11-10T10:00:00Z"), 90, [], CHICAGO)).toEqual(d("2026-11-10T11:30:00Z"));
    // A close at or before the open is not a window.
    expect(
      addBusinessMinutes(d("2026-11-10T10:00:00Z"), 60, [{ day: 2, open: "17:00", close: "08:00" }], CHICAGO),
    ).toEqual(d("2026-11-10T11:00:00Z"));
  });

  it("returns the start for zero or negative minutes", () => {
    const start = d("2026-11-14T03:00:00Z");
    expect(addBusinessMinutes(start, 0, weekdays("08:00", "17:00"), CHICAGO)).toEqual(start);
    expect(addBusinessMinutes(start, -5, weekdays("08:00", "17:00"), CHICAGO)).toEqual(start);
  });

  it("runs only inside business hours, starting at the next opening", () => {
    const hours = weekdays("08:00", "17:00");
    // Tuesday 10 Nov 2026, 09:00 in Chicago (CST, UTC-6) + 2 h → 11:00 local.
    expect(addBusinessMinutes(d("2026-11-10T15:00:00Z"), 120, hours, CHICAGO)).toEqual(
      d("2026-11-10T17:00:00Z"),
    );
    // 16:00 local + 2 h → 1 h today, 1 h tomorrow from 08:00 → Wednesday 09:00 local.
    expect(addBusinessMinutes(d("2026-11-10T22:00:00Z"), 120, hours, CHICAGO)).toEqual(
      d("2026-11-11T15:00:00Z"),
    );
    // Created at 20:00 local on Friday → nothing counts until Monday 08:00; +30 min → 08:30 Monday.
    expect(addBusinessMinutes(d("2026-11-14T02:00:00Z"), 30, hours, CHICAGO)).toEqual(
      d("2026-11-16T14:30:00Z"),
    );
    // A window ending exactly when the minutes run out ends there, not at the next opening.
    expect(addBusinessMinutes(d("2026-11-10T22:00:00Z"), 60, hours, CHICAGO)).toEqual(
      d("2026-11-10T23:00:00Z"),
    );
  });

  it("spans several days and split windows", () => {
    const hours: WorkingHoursEntry[] = [
      ...weekdays("08:00", "12:00"),
      ...weekdays("13:00", "17:00"),
      { day: 6, open: "09:00", close: "12:00" },
    ];
    // Thursday 12 Nov 11:00 local: 1 h (11–12), 4 h (13–17), Friday 8 h, Saturday 3 h = 16 h; 2 h more on Monday.
    expect(addBusinessMinutes(d("2026-11-12T17:00:00Z"), 18 * 60, hours, CHICAGO)).toEqual(
      d("2026-11-16T16:00:00Z"),
    );
    // Odd minutes and fractions of a minute are kept.
    expect(addBusinessMinutes(d("2026-11-12T14:00:00Z"), 7.5, hours, CHICAGO)).toEqual(
      d("2026-11-12T14:07:30Z"),
    );
  });

  it("handles daylight saving changes", () => {
    const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: "08:00", close: "17:00" }));
    // Saturday 31 Oct 2026, 16:00 CDT (UTC-5). Sunday 1 Nov is back on CST (UTC-6). 2 h → Sunday 09:00 CST.
    expect(addBusinessMinutes(d("2026-10-31T21:00:00Z"), 120, hours, CHICAGO)).toEqual(
      d("2026-11-01T15:00:00Z"),
    );
    // Spring forward: Saturday 13 Mar 2027 16:00 CST → Sunday 14 Mar 09:00 CDT (UTC-5).
    expect(addBusinessMinutes(d("2027-03-13T22:00:00Z"), 120, hours, CHICAGO)).toEqual(
      d("2027-03-14T14:00:00Z"),
    );
  });

  it("uses the organization's time zone (Jakarta, no daylight saving)", () => {
    const hours: WorkingHoursEntry[] = [
      ...weekdays("08:00", "17:00"),
      { day: 6, open: "08:00", close: "13:00" },
    ];
    // Saturday 14 Nov 12:00 WIB (UTC+7) + 3 h → 1 h Saturday, Monday 08:00 + 2 h = 10:00 WIB.
    expect(addBusinessMinutes(d("2026-11-14T05:00:00Z"), 180, hours, JAKARTA)).toEqual(
      d("2026-11-16T03:00:00Z"),
    );
  });

  it("serves several offsets in one walk, in any order", () => {
    const hours = weekdays("08:00", "17:00");
    const start = d("2026-11-10T22:00:00Z"); // Tuesday 16:00 in Chicago
    expect(addBusinessMinutesEach(start, [120, 0, 30, 60, 600], hours, CHICAGO)).toEqual([
      d("2026-11-11T15:00:00Z"),
      start,
      d("2026-11-10T22:30:00Z"),
      d("2026-11-10T23:00:00Z"),
      d("2026-11-11T23:00:00Z"), // 1 h Tuesday + 9 h Wednesday
    ]);
    expect(addBusinessMinutesEach(start, [-1, 5], [], CHICAGO)).toEqual([start, d("2026-11-10T22:05:00Z")]);
  });

  it("gives up on windows that would take more than ten years", () => {
    const tiny = [{ day: 1, open: "08:00", close: "08:01" }];
    expect(() => addBusinessMinutes(d("2026-11-10T00:00:00Z"), 1_000_000, tiny, "UTC")).toThrow(RangeError);
  });
});

describe("slaDeadlines", () => {
  const createdAt = d("2026-11-10T22:00:00Z"); // Tuesday 16:00 in Chicago

  it("computes calendar deadlines and at-risk points at 75%", () => {
    expect(
      slaDeadlines({
        createdAt,
        policy: defaultTargets("urgent"),
        businessHours: weekdays("08:00", "17:00"),
        timeZone: CHICAGO,
      }),
    ).toEqual({
      responseDueAt: d("2026-11-11T00:00:00Z"),
      resolutionDueAt: d("2026-11-11T22:00:00Z"),
      responseAtRiskAt: d("2026-11-10T23:30:00Z"),
      resolutionAtRiskAt: d("2026-11-11T16:00:00Z"),
    });
  });

  it("counts business hours when the policy says so", () => {
    const out = slaDeadlines({
      createdAt,
      policy: { responseMin: 120, resolutionMin: 18 * 60, businessHours: true },
      businessHours: weekdays("08:00", "17:00"),
      timeZone: CHICAGO,
    });
    // Response: 1 h Tuesday + 1 h Wednesday → Wed 09:00; at risk after 90 min → Wed 08:30.
    expect(out.responseDueAt).toEqual(d("2026-11-11T15:00:00Z"));
    expect(out.responseAtRiskAt).toEqual(d("2026-11-11T14:30:00Z"));
    // Resolution: 1 h Tue, 9 h Wed, 8 h Thu → Thu 16:00; 13.5 h → Thu 11:30.
    expect(out.resolutionDueAt).toEqual(d("2026-11-12T22:00:00Z"));
    expect(out.resolutionAtRiskAt).toEqual(d("2026-11-12T17:30:00Z"));
  });

  it("falls back to calendar time when the organization has no business hours", () => {
    const out = slaDeadlines({
      createdAt,
      policy: { responseMin: 120, resolutionMin: 240, businessHours: true },
      businessHours: [],
      timeZone: CHICAGO,
    });
    expect(out.responseDueAt).toEqual(d("2026-11-11T00:00:00Z"));
  });
});

describe("slaState", () => {
  const dueAt = d("2026-11-10T12:00:00Z");
  const atRiskAt = d("2026-11-10T11:00:00Z");
  it("moves from on track to at risk to breached", () => {
    expect(slaState({ dueAt, atRiskAt, doneAt: null, now: d("2026-11-10T10:59:00Z") })).toBe("on_track");
    expect(slaState({ dueAt, atRiskAt, doneAt: null, now: atRiskAt })).toBe("at_risk");
    expect(slaState({ dueAt, atRiskAt, doneAt: null, now: dueAt })).toBe("at_risk");
    expect(slaState({ dueAt, atRiskAt, doneAt: null, now: d("2026-11-10T12:00:01Z") })).toBe("breached");
    expect(slaState({ dueAt, atRiskAt: null, doneAt: null, now: d("2026-11-10T11:59:00Z") })).toBe(
      "on_track",
    );
  });
  it("reports met or breached once done, and nothing without a deadline", () => {
    expect(slaState({ dueAt, atRiskAt, doneAt: dueAt, now: d("2026-11-11T00:00:00Z") })).toBe("met");
    expect(slaState({ dueAt, atRiskAt, doneAt: d("2026-11-10T12:01:00Z"), now: dueAt })).toBe("breached");
    expect(slaState({ dueAt: null, atRiskAt, doneAt: null, now: dueAt })).toBeNull();
  });
});

describe("currentSla", () => {
  const base: SlaFacts = {
    status: "new",
    firstScheduledAt: null,
    responseDueAt: d("2026-11-10T12:00:00Z"),
    resolutionDueAt: d("2026-11-17T12:00:00Z"),
    slaResponseState: "at_risk",
    slaResolutionState: "on_track",
  };
  it("takes the worse open target, the response on ties", () => {
    expect(currentSla(base)).toEqual({ target: "response", state: "at_risk", dueAt: base.responseDueAt });
    expect(currentSla({ ...base, slaResponseState: "on_track" })).toMatchObject({ target: "response" });
    expect(
      currentSla({ ...base, slaResponseState: "on_track", slaResolutionState: "breached" }),
    ).toMatchObject({
      target: "resolution",
      state: "breached",
    });
  });
  it("uses the resolution once scheduled or completed", () => {
    const scheduled = { ...base, status: "scheduled" as const, firstScheduledAt: d("2026-11-10T13:00:00Z") };
    expect(currentSla({ ...scheduled, slaResponseState: "breached" })).toMatchObject({
      target: "resolution",
      state: "on_track",
    });
    expect(currentSla({ ...base, status: "completed", slaResolutionState: "met" })).toMatchObject({
      state: "met",
    });
  });
  it("handles missing states and canceled jobs", () => {
    expect(currentSla({ ...base, status: "canceled" })).toBeNull();
    expect(currentSla({ ...base, slaResponseState: null })).toMatchObject({ target: "resolution" });
    expect(currentSla({ ...base, slaResolutionState: null })).toMatchObject({ target: "response" });
    expect(currentSla({ ...base, slaResponseState: null, slaResolutionState: null })).toBeNull();
  });
});

describe("needsAttention", () => {
  it("is true for at risk and breached only", () => {
    expect(
      ["on_track", "at_risk", "breached", "met", null, undefined].map((s) => needsAttention(s as never)),
    ).toEqual([false, true, true, false, false, false]);
  });
});
