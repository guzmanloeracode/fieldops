import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../domain/errors";
import { iso, world } from "../test/fixtures";
import * as jobs from "./jobs";
import * as sla from "./sla";

// ctxFor() pins "now" to 2026-11-10T09:00Z; the memory organization is in UTC without business hours.
const NOW = new Date("2026-11-10T09:00:00Z");
const at = (h: number, day = 10) => new Date(Date.UTC(2026, 10, day, h));
const min = (m: number) => m * 60_000;

type World = ReturnType<typeof world>;

const policies = (overrides: Record<string, unknown> = {}) => ({
  policies: [
    { priority: "low", response_min: 3 * 1440, resolution_min: 14 * 1440, business_hours: true },
    { priority: "normal", response_min: 1440, resolution_min: 7 * 1440, business_hours: false },
    { priority: "high", response_min: 240, resolution_min: 2 * 1440, business_hours: false },
    { priority: "urgent", response_min: 60, resolution_min: 480, business_hours: false, ...overrides },
  ],
});

async function newJob(w: World, extra: Record<string, unknown> = {}) {
  return jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC leaking",
    ...extra,
  });
}

describe("SLA policies (SLA-01)", () => {
  it("lists the defaults until the organization saves its own", async () => {
    const w = world();
    const list = await sla.listPolicies(w.ctx(w.tom));
    expect(
      list.map((p) => [p.priority, p.responseMin, p.resolutionMin, p.businessHours, p.isDefault]),
    ).toEqual([
      ["low", 4320, 20160, false, true],
      ["normal", 1440, 10080, false, true],
      ["high", 480, 4320, false, true],
      ["urgent", 120, 1440, false, true],
    ]);
  });

  it("saves all four priorities for owners and admins, and keeps them on a second save", async () => {
    const w = world();
    const saved = await sla.updatePolicies(w.ctx(w.admin), policies());
    expect(saved.every((p) => !p.isDefault && p.id)).toBe(true);
    expect(saved.find((p) => p.priority === "low")).toMatchObject({ businessHours: true, responseMin: 4320 });
    const again = await sla.updatePolicies(w.ctx(w.owner), policies({ response_min: 30 }));
    expect(again.find((p) => p.priority === "urgent")).toMatchObject({ responseMin: 30, id: saved[3]!.id });
    expect(w.data.automate!.slaPolicies).toHaveLength(4);
  });

  it("rejects dispatchers and inconsistent targets", async () => {
    const w = world();
    await expect(sla.updatePolicies(w.ctx(w.dispatcher), policies())).rejects.toThrow(ForbiddenError);
    await expect(sla.updatePolicies(w.ctx(w.owner), policies({ response_min: 480 }))).rejects.toThrow(
      ValidationError,
    );
    await expect(
      sla.updatePolicies(w.ctx(w.owner), { policies: policies().policies.slice(0, 3) }),
    ).rejects.toThrow(ValidationError);
    const dup = policies().policies.map((p) => ({ ...p, priority: "low" }));
    await expect(sla.updatePolicies(w.ctx(w.owner), { policies: dup })).rejects.toThrow(ValidationError);
  });
});

describe("SLA on jobs (SLA-02)", () => {
  it("stores deadlines and states when a job is created", async () => {
    const w = world();
    const job = await newJob(w, { priority: "urgent" });
    expect(job).toMatchObject({
      slaPolicyId: null,
      responseDueAt: at(11),
      responseAtRiskAt: new Date(NOW.getTime() + min(90)),
      resolutionDueAt: at(9, 11),
      resolutionAtRiskAt: at(3, 11),
      slaResponseState: "on_track",
      slaResolutionState: "on_track",
    });
    await sla.updatePolicies(w.ctx(w.owner), policies());
    const next = await newJob(w, { priority: "urgent" });
    expect(next.slaPolicyId).toBe(w.data.automate!.slaPolicies.find((p) => p.priority === "urgent")!.id);
    expect(next.responseDueAt).toEqual(at(10));
  });

  it("counts business hours for policies that ask for them", async () => {
    const w = world();
    w.data.org.businessHours = [1, 2, 3, 4, 5].map((day) => ({ day, open: "08:00", close: "17:00" }));
    await sla.updatePolicies(w.ctx(w.owner), policies());
    // Tuesday 09:00 UTC + 72 business hours (9-hour weekdays): 8 h Tue, 9 h × 7 days, 1 h on Friday the 20th.
    const low = await newJob(w, { priority: "low" });
    expect(low.responseDueAt).toEqual(at(9, 20));
  });

  it("marks the response met when the job is first scheduled, and the resolution when completed", async () => {
    const w = world();
    let job = await newJob(w, { priority: "high" });
    job = await jobs.assignJob(w.ctx(w.dispatcher), job.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(10),
      scheduled_end: iso(12),
    });
    expect([job.slaResponseState, job.slaResolutionState]).toEqual(["met", "on_track"]);
    await jobs.transitionJob(w.ctx(w.tom), job.id, { to: "in_progress" });
    job = await jobs.transitionJob(w.ctx(w.tom), job.id, { to: "completed" });
    expect([job.slaResponseState, job.slaResolutionState]).toEqual(["met", "met"]);
    // Reopened: the resolution clock runs again.
    job = await jobs.transitionJob(w.ctx(w.dispatcher), job.id, {
      to: "in_progress",
      reason: "Still leaking",
    });
    expect(job.slaResolutionState).toBe("on_track");
  });

  it("reports breaches for late work and clears both states on cancel", async () => {
    const w = world();
    let job = await newJob(w, { priority: "urgent" });
    const stored = w.data.jobs.find((j) => j.id === job.id)!;
    Object.assign(stored, { responseDueAt: at(8), resolutionDueAt: at(8) });
    job = await jobs.assignJob(w.ctx(w.dispatcher), job.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(10),
      scheduled_end: iso(12),
    });
    expect([job.slaResponseState, job.slaResolutionState]).toEqual(["breached", "breached"]);
    job = await jobs.transitionJob(w.ctx(w.dispatcher), job.id, {
      to: "canceled",
      reason: "Customer canceled",
    });
    expect([job.slaResponseState, job.slaResolutionState]).toEqual([null, null]);
  });

  it("recomputes the deadlines from the creation time when the priority changes", async () => {
    const w = world();
    const job = await newJob(w, { priority: "low" });
    const created = w.data.jobs.find((j) => j.id === job.id)!.createdAt;
    const updated = await jobs.updateJob(w.ctx(w.dispatcher), job.id, { priority: "urgent" });
    expect(updated.responseDueAt).toEqual(new Date(created.getTime() + min(120)));
    expect(updated.resolutionDueAt).toEqual(new Date(created.getTime() + min(1440)));
    // Other edits keep the deadlines.
    const renamed = await jobs.updateJob(w.ctx(w.dispatcher), job.id, { title: "Renamed" });
    expect(renamed.responseDueAt).toEqual(updated.responseDueAt);
  });
});

describe("SLA monitor (SLA-03)", () => {
  async function overdue(w: World, priority = "normal") {
    const job = await newJob(w, { priority });
    const stored = w.data.jobs.find((j) => j.id === job.id)!;
    return stored;
  }

  it("moves open jobs along and notifies once per job, target and kind", async () => {
    const w = world();
    const a = await overdue(w);
    Object.assign(a, { responseAtRiskAt: at(8), responseDueAt: at(10) });
    const b = await overdue(w);
    Object.assign(b, { resolutionAtRiskAt: at(6), resolutionDueAt: at(7) });
    const done = await overdue(w);
    Object.assign(done, { status: "completed", responseDueAt: at(1) });

    const first = await sla.monitorSla({ store: w.store, now: NOW });
    expect(first).toEqual({ updated: 2, alerts: 2 });
    expect(a.slaResponseState).toBe("at_risk");
    expect(b.slaResolutionState).toBe("breached");
    expect(done.slaResponseState).toBe("on_track");
    const sent = w.data.automate!.notifications;
    expect(sent.filter((n) => n.type === "sla_at_risk").map((n) => n.userId)).toEqual([w.dispatcher.userId]);
    expect(sent.filter((n) => n.type === "sla_breached").map((n) => n.userId)).toEqual([
      w.dispatcher.userId,
      w.owner.userId,
    ]);
    expect(sent.find((n) => n.type === "sla_at_risk")!.payload).toMatchObject({
      job_id: a.id,
      job_number: a.number,
      job_title: "AC leaking",
      customer_name: "Cara Customer",
      target: "response",
      due_at: at(10).toISOString(),
    });

    // Same time again: nothing changes, nothing is raised.
    expect(await sla.monitorSla({ store: w.store, now: NOW })).toEqual({ updated: 0, alerts: 0 });
    // Later: a is now breached → one new alert.
    expect(await sla.monitorSla({ store: w.store, now: at(11) })).toMatchObject({ alerts: 1 });
    expect(w.data.automate!.notifications.filter((n) => n.type === "sla_breached")).toHaveLength(4);
  });

  it("tells the managers when there is no dispatcher, and leaves out the payload's due time without one", async () => {
    const w = world();
    w.data.members = w.data.members.filter((m) => m.role !== "dispatcher");
    const j = await overdue(w);
    Object.assign(j, {
      firstScheduledAt: at(1),
      slaResponseState: "met",
      resolutionDueAt: null,
      slaResolutionState: "at_risk",
    });
    expect(await sla.monitorSla({ store: w.store, now: NOW })).toMatchObject({ alerts: 1 });
    const n = w.data.automate!.notifications;
    expect(n.map((x) => x.userId).sort()).toEqual([w.admin.userId, w.owner.userId].sort());
    expect(n[0]!.payload.due_at).toBeUndefined();
  });

  it("does nothing without at-risk jobs", async () => {
    const w = world();
    await overdue(w);
    expect(await sla.monitorSla({ store: w.store, now: NOW })).toEqual({ updated: 0, alerts: 0 });
  });
});
