import { describe, expect, it } from "vitest";
import { iso, world } from "../test/fixtures";
import * as jobs from "./jobs";
import * as sla from "./sla";

// SLA-04: on hold waiting for the customer pauses the resolution clock. ctxFor() pins "now" to
// 2026-11-10T09:00Z; the memory organization is in UTC.

type World = ReturnType<typeof world>;
const at = (h: number, day = 11, m = 0) => new Date(Date.UTC(2026, 10, day, h, m));
const MIN = 60_000;

/** A normal-priority job in progress since 11 Nov 09:00, worked by Tom. */
async function inProgress(w: World) {
  const job = await jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC not cooling",
  });
  // The memory store stamps real time; pin the creation to "now" like the database would.
  w.data.jobs.find((j) => j.id === job.id)!.createdAt = new Date("2026-11-10T09:00:00Z");
  await jobs.assignJob(w.ctx(w.dispatcher), job.id, {
    member_ids: [w.tom.id],
    scheduled_start: iso(9),
    scheduled_end: iso(11),
  });
  return jobs.transitionJob(w.ctx(w.tom, { now: at(9) }), job.id, { to: "in_progress" });
}

const hold = (w: World, id: string, now: Date, reason: "customer" | "parts" = "customer") =>
  jobs.transitionJob(w.ctx(w.tom, { now }), id, {
    to: "on_hold",
    reason: "Customer is away",
    hold_reason: reason,
  });

const statusEvent = (w: World, jobId: string, to: string) =>
  w.data.events.filter((e) => e.jobId === jobId && e.toStatus === to).at(-1)!;

describe("pausing the resolution clock (SLA-04)", () => {
  it("pauses on hold for the customer and moves the deadline by the pause on resume", async () => {
    const w = world();
    const job = await inProgress(w);
    const due = job.resolutionDueAt!;
    const atRisk = job.resolutionAtRiskAt!;
    const held = await hold(w, job.id, at(10));
    expect(held).toMatchObject({ slaPausedAt: at(10), slaPausedMinutes: 0, resolutionDueAt: due });
    expect(statusEvent(w, job.id, "on_hold").payload).toMatchObject({ sla_paused: true });

    // Back two days and three hours later.
    const resumed = await jobs.transitionJob(w.ctx(w.tom, { now: at(13, 13) }), job.id, {
      to: "in_progress",
    });
    const pause = 51 * 60;
    expect(resumed).toMatchObject({
      slaPausedAt: null,
      slaPausedMinutes: pause,
      slaResolutionState: "on_track",
    });
    expect(resumed.resolutionDueAt!.getTime() - due.getTime()).toBe(pause * MIN);
    expect(resumed.resolutionAtRiskAt!.getTime() - atRisk.getTime()).toBe(pause * MIN);
    expect(statusEvent(w, job.id, "in_progress").payload).toMatchObject({
      transition: "resume",
      sla_paused_minutes: pause,
      resolution_due_at: resumed.resolutionDueAt!.toISOString(),
    });

    // A second pause adds to the total.
    await hold(w, job.id, at(9, 14));
    const again = await jobs.transitionJob(w.ctx(w.tom, { now: at(10, 14) }), job.id, { to: "in_progress" });
    expect(again.slaPausedMinutes).toBe(pause + 60);
  });

  it("doesn't pause for other hold reasons", async () => {
    const w = world();
    const job = await inProgress(w);
    const held = await hold(w, job.id, at(10), "parts");
    expect(held.slaPausedAt).toBeNull();
    const resumed = await jobs.transitionJob(w.ctx(w.tom, { now: at(12, 12) }), job.id, {
      to: "in_progress",
    });
    expect(resumed).toMatchObject({ slaPausedMinutes: 0, resolutionDueAt: job.resolutionDueAt });
    expect(statusEvent(w, job.id, "in_progress").payload).toEqual({ transition: "resume" });
  });

  it("ends the pause when the dispatcher reschedules the job", async () => {
    const w = world();
    const job = await inProgress(w);
    await hold(w, job.id, at(10));
    const rescheduled = await jobs.assignJob(w.ctx(w.dispatcher, { now: at(11) }), job.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(9, 12),
      scheduled_end: iso(11, 12),
    });
    expect(rescheduled).toMatchObject({ status: "scheduled", slaPausedAt: null, slaPausedMinutes: 60 });
    expect(rescheduled.resolutionDueAt!.getTime() - job.resolutionDueAt!.getTime()).toBe(60 * MIN);
    const assigned = w.data.events.filter((e) => e.jobId === job.id && e.type === "assigned").at(-1)!;
    expect(assigned.payload).toMatchObject({ sla_paused_minutes: 60 });
  });

  it("keeps the state it had while paused, even past the old deadline", async () => {
    const w = world();
    const job = await inProgress(w);
    await hold(w, job.id, at(10));
    // A change while paused, long after the original deadline, doesn't breach the job.
    const later = new Date(job.resolutionDueAt!.getTime() + 3 * 86_400_000);
    const edited = await jobs.updateJob(w.ctx(w.dispatcher, { now: later }), job.id, {
      title: "AC still off",
    });
    expect(edited).toMatchObject({ slaResolutionState: "on_track", slaPausedAt: at(10) });

    // A priority change while paused recomputes the deadlines and keeps the clock stopped, judged when it
    // stopped. High: three days to complete from creation (10 Nov 09:00).
    const high = await jobs.updateJob(w.ctx(w.dispatcher, { now: later }), job.id, { priority: "high" });
    expect(high).toMatchObject({ slaPausedAt: at(10), slaResolutionState: "on_track" });
    expect(high.resolutionDueAt).toEqual(at(9, 13));
    // Urgent was due before the pause began: breached.
    const urgent = await jobs.updateJob(w.ctx(w.dispatcher, { now: later }), job.id, { priority: "urgent" });
    expect(urgent.slaResolutionState).toBe("breached");
  });

  it("keeps the minutes already paused when the priority changes later", async () => {
    const w = world();
    const job = await inProgress(w);
    await hold(w, job.id, at(10));
    await jobs.transitionJob(w.ctx(w.tom, { now: at(12) }), job.id, { to: "in_progress" });
    const high = await jobs.updateJob(w.ctx(w.dispatcher, { now: at(12) }), job.id, { priority: "high" });
    // High: three days from creation, plus the two paused hours.
    expect(high.resolutionDueAt).toEqual(at(11, 13));
  });

  it("measures the pause in business hours for a business-hours policy", async () => {
    const w = world();
    w.data.org.businessHours = [1, 2, 3, 4, 5].map((day) => ({ day, open: "08:00", close: "17:00" }));
    await sla.updatePolicies(w.ctx(w.owner), {
      policies: [
        { priority: "low", response_min: 3 * 1440, resolution_min: 14 * 1440, business_hours: false },
        { priority: "normal", response_min: 1440, resolution_min: 7 * 1440, business_hours: true },
        { priority: "high", response_min: 240, resolution_min: 2 * 1440, business_hours: false },
        { priority: "urgent", response_min: 60, resolution_min: 480, business_hours: false },
      ],
    });
    const job = await inProgress(w);
    // Wednesday 16:00 → Thursday 09:00 UTC: one business hour each day.
    await hold(w, job.id, at(16));
    const resumed = await jobs.transitionJob(w.ctx(w.tom, { now: at(9, 12) }), job.id, { to: "in_progress" });
    expect(resumed.slaPausedMinutes).toBe(120);
    expect(resumed.resolutionDueAt!.getTime()).toBeGreaterThan(job.resolutionDueAt!.getTime());
  });

  it("isn't moved or alerted by the monitor while paused", async () => {
    const w = world();
    const job = await inProgress(w);
    await hold(w, job.id, at(10));
    const late = new Date(job.resolutionDueAt!.getTime() + 86_400_000);
    const r = await sla.monitorSla({ store: w.store, now: late });
    expect(r).toEqual({ updated: 0, alerts: 0 });
    expect(w.data.jobs.find((j) => j.id === job.id)!.slaResolutionState).toBe("on_track");
    // Once resumed past the moved deadline, the monitor alerts as usual.
    await jobs.transitionJob(w.ctx(w.tom, { now: at(11) }), job.id, { to: "in_progress" });
    const r2 = await sla.monitorSla({ store: w.store, now: late });
    expect(r2.alerts).toBe(1);
  });
});

describe("pauseEventPayload", () => {
  it("says nothing when the pause doesn't change", async () => {
    const w = world();
    const job = await inProgress(w);
    expect(sla.pauseEventPayload(job, { title: "x" })).toEqual({});
    expect(
      sla.pauseEventPayload({ ...job, slaPausedAt: at(10), slaPausedMinutes: 5 }, { slaPausedAt: null }),
    ).toEqual({ sla_paused_minutes: 0, resolution_due_at: null });
  });
});
