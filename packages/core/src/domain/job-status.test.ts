import { JOB_STATUSES, type JobStatus, type Role } from "@fieldops/shared";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "./errors";
import {
  assertTransition,
  availableTransitions,
  findTransition,
  InvalidTransitionError,
  isOpen,
  OPEN_STATUSES,
  STATUS_LABELS,
  TERMINAL_STATUSES,
  TRANSITIONS,
  type TransitionFacts,
} from "./job-status";

const READY: TransitionFacts = {
  assigned: true,
  hasAssignee: true,
  hasSchedule: true,
  missingRequiredItems: [],
};
const ALLOWED: [JobStatus, JobStatus][] = [
  ["new", "scheduled"],
  ["new", "canceled"],
  ["scheduled", "new"],
  ["scheduled", "en_route"],
  ["scheduled", "in_progress"],
  ["scheduled", "canceled"],
  ["en_route", "in_progress"],
  ["in_progress", "on_hold"],
  ["on_hold", "in_progress"],
  ["on_hold", "scheduled"],
  ["in_progress", "completed"],
  ["completed", "in_progress"],
];
const isAllowed = (from: JobStatus, to: JobStatus) => ALLOWED.some(([f, t]) => f === from && t === to);
const fullRequest = (to: JobStatus) => ({ to, reason: "because", holdReason: "parts" as const });

describe("job status machine", () => {
  it("lists exactly the transitions in the PRD diagram", () => {
    expect(TRANSITIONS.map((t) => [t.from, t.to])).toEqual(ALLOWED);
  });

  for (const from of JOB_STATUSES) {
    for (const to of JOB_STATUSES) {
      if (isAllowed(from, to)) {
        it(`allows ${from} → ${to} for an owner`, () => {
          expect(assertTransition({ role: "owner" }, from, fullRequest(to), READY).to).toBe(to);
        });
      } else {
        it(`rejects ${from} → ${to}`, () => {
          expect(findTransition(from, to)).toBeUndefined();
          expect(() => assertTransition({ role: "owner" }, from, fullRequest(to), READY)).toThrow(
            InvalidTransitionError,
          );
        });
      }
    }
  }

  it("requires a reason to cancel, hold and reopen", () => {
    for (const [from, to] of [
      ["new", "canceled"],
      ["scheduled", "canceled"],
      ["in_progress", "on_hold"],
      ["completed", "in_progress"],
    ] as [JobStatus, JobStatus][]) {
      expect(() => assertTransition({ role: "owner" }, from, { to, holdReason: "parts" }, READY)).toThrow(
        /reason is required/,
      );
      expect(() =>
        assertTransition({ role: "owner" }, from, { to, reason: "   ", holdReason: "parts" }, READY),
      ).toThrow(InvalidTransitionError);
    }
  });

  it("requires a hold reason code to put a job on hold", () => {
    try {
      assertTransition({ role: "technician" }, "in_progress", { to: "on_hold", reason: "Waiting" }, READY);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).details).toEqual({ field: "hold_reason" });
    }
  });

  it("needs a technician before scheduling, departing or starting", () => {
    const facts = { ...READY, hasAssignee: false };
    for (const [from, to] of [
      ["new", "scheduled"],
      ["scheduled", "en_route"],
      ["scheduled", "in_progress"],
      ["en_route", "in_progress"],
      ["on_hold", "scheduled"],
    ] as [JobStatus, JobStatus][]) {
      expect(() => assertTransition({ role: "owner" }, from, { to }, facts)).toThrow(/Assign a technician/);
    }
  });

  it("needs a schedule before scheduling", () => {
    expect(() =>
      assertTransition({ role: "owner" }, "new", { to: "scheduled" }, { ...READY, hasSchedule: false }),
    ).toThrow(/scheduled time/);
    expect(() =>
      assertTransition({ role: "owner" }, "on_hold", { to: "scheduled" }, { ...READY, hasSchedule: false }),
    ).toThrow(/scheduled time/);
  });

  it("lists missing checklist items when completing too early (JOB-08 acceptance)", () => {
    try {
      assertTransition(
        { role: "technician" },
        "in_progress",
        { to: "completed" },
        { ...READY, missingRequiredItems: ["Photo of filter", "Pressure"] },
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).details).toEqual({ missing: ["Photo of filter", "Pressure"] });
    }
  });

  describe("who may run a move", () => {
    const office: Role[] = ["owner", "admin", "dispatcher"];
    it("office moves are closed to technicians, even assigned ones", () => {
      for (const t of TRANSITIONS.filter((x) => x.by === "office")) {
        for (const role of office)
          expect(() => assertTransition({ role }, t.from, fullRequest(t.to), READY)).not.toThrow();
        expect(() => assertTransition({ role: "technician" }, t.from, fullRequest(t.to), READY)).toThrow(
          ForbiddenError,
        );
      }
    });
    it("work moves are open to the assigned technician only", () => {
      for (const t of TRANSITIONS.filter((x) => x.by === "work")) {
        expect(() =>
          assertTransition({ role: "technician" }, t.from, fullRequest(t.to), READY),
        ).not.toThrow();
        expect(() =>
          assertTransition({ role: "technician" }, t.from, fullRequest(t.to), { ...READY, assigned: false }),
        ).toThrow(ForbiddenError);
        for (const role of office) {
          expect(() =>
            assertTransition({ role }, t.from, fullRequest(t.to), { ...READY, assigned: false }),
          ).not.toThrow();
        }
      }
    });
    it("reopen is for the office", () => {
      expect(() =>
        assertTransition(
          { role: "dispatcher" },
          "completed",
          { to: "in_progress", reason: "Leak again" },
          READY,
        ),
      ).not.toThrow();
      expect(() =>
        assertTransition({ role: "technician" }, "completed", { to: "in_progress", reason: "x" }, READY),
      ).toThrow(ForbiddenError);
    });
  });

  describe("availableTransitions", () => {
    it("shows a technician only work moves on assigned jobs", () => {
      expect(
        availableTransitions({ role: "technician" }, "scheduled", { assigned: true }).map((t) => t.name),
      ).toEqual(["depart", "start"]);
      expect(availableTransitions({ role: "technician" }, "scheduled", { assigned: false })).toEqual([]);
      expect(availableTransitions({ role: "technician" }, "completed", { assigned: true })).toEqual([]);
    });
    it("shows a dispatcher every move from the status", () => {
      expect(
        availableTransitions({ role: "dispatcher" }, "scheduled", { assigned: false }).map((t) => t.name),
      ).toEqual(["unschedule", "depart", "start", "cancel"]);
      expect(
        availableTransitions({ role: "dispatcher" }, "completed", { assigned: false }).map((t) => t.name),
      ).toEqual(["reopen"]);
      expect(availableTransitions({ role: "owner" }, "canceled", { assigned: true })).toEqual([]);
    });
  });

  it("classifies open and terminal statuses", () => {
    expect([...OPEN_STATUSES, ...TERMINAL_STATUSES].sort()).toEqual([...JOB_STATUSES].sort());
    expect(isOpen("on_hold")).toBe(true);
    expect(isOpen("completed")).toBe(false);
    expect(Object.keys(STATUS_LABELS)).toHaveLength(JOB_STATUSES.length);
  });
});
