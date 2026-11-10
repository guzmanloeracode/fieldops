import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { world } from "../test/fixtures";
import { opsState } from "../test/memory-ops";
import * as recurrences from "./recurrences";

// Maintenance plans (JOB-13). ctxFor() pins "now" to 2026-11-10T09:00Z; the memory organization is in UTC.

type World = ReturnType<typeof world>;
const day = (date: string, h = 9) => new Date(`${date}T${String(h).padStart(2, "0")}:00:00Z`);

function planInput(w: World, extra: Record<string, unknown> = {}) {
  return {
    customer_id: w.customerId,
    site_id: w.siteId,
    equipment_id: w.equipmentId,
    service_type_id: w.serviceTypeId,
    title: "Quarterly AC service",
    description: "Clean filters and coils",
    interval_unit: "month",
    interval_count: 3,
    starts_on: "2026-11-15",
    window_start: "09:00",
    window_minutes: 120,
    lead_days: 14,
    lead_member_id: w.tom.id,
    ...extra,
  };
}

const planJobs = (w: World, id: string) =>
  w.data.jobs.filter((j) => j.recurrenceId === id).sort((a, b) => a.number - b.number);

describe("creating a plan (JOB-13)", () => {
  it("generates the jobs within the lead time right away, built like createJob", async () => {
    const w = world();
    w.data.serviceTypes[0]!.checklistTemplate = [
      { label: "Clean filters", kind: "checkbox", required: true },
      { label: "Pressure", kind: "number", unit: "psi", required: false },
    ];
    const plan = await recurrences.createPlan(w.ctx(w.dispatcher), planInput(w));
    expect(plan).toMatchObject({
      intervalUnit: "month",
      intervalCount: 3,
      nextOn: "2027-02-15",
      active: true,
      jobCount: 1,
      lastOccurrence: "2026-11-15",
      createdBy: w.dispatcher.userId,
      leadMember: { memberId: w.tom.id, name: "Tom Tech" },
      serviceType: { id: w.serviceTypeId, name: "AC repair" },
      customer: { id: w.customerId, name: "Cara Customer" },
    });
    const [job] = planJobs(w, plan.id);
    expect(job).toMatchObject({
      source: "recurring",
      status: "new",
      occurrenceDate: "2026-11-15",
      title: "Quarterly AC service",
      description: "Clean filters and coils",
      priority: "normal",
      equipmentId: w.equipmentId,
      serviceTypeId: w.serviceTypeId,
      estimatedDurationMin: 120,
      preferredStart: day("2026-11-15"),
      preferredEnd: day("2026-11-15", 11),
      needsReview: false,
      createdBy: null,
      // The SLA clock starts on the visit date (normal: 1 day to schedule, 7 to complete).
      responseDueAt: day("2026-11-16", 0),
      resolutionDueAt: day("2026-11-22", 0),
      slaResponseState: "on_track",
    });
    // The preferred technician is only suggested: the job waits for the dispatcher.
    expect(w.data.assignments.filter((a) => a.jobId === job!.id)).toEqual([]);
    expect(w.data.checklist.filter((c) => c.jobId === job!.id).map((c) => c.label)).toEqual([
      "Clean filters",
      "Pressure",
    ]);
    expect(w.data.events.find((e) => e.jobId === job!.id)).toMatchObject({
      type: "created",
      actorUserId: null,
      payload: { source: "recurring", recurrence_id: plan.id, occurrence_date: "2026-11-15" },
    });
  });

  it("starts from today when the start date is in the past, without a backlog", async () => {
    const w = world();
    // Thursdays since 1 January 2026; today is Tuesday 10 November.
    const plan = await recurrences.createPlan(
      w.ctx(w.owner),
      planInput(w, {
        interval_unit: "week",
        interval_count: 1,
        starts_on: "2026-01-01",
        lead_days: 7,
        window_start: null,
        window_minutes: null,
        equipment_id: null,
        service_type_id: null,
        lead_member_id: null,
        priority: "low",
      }),
    );
    const jobs = planJobs(w, plan.id);
    expect(jobs.map((j) => j.occurrenceDate)).toEqual(["2026-11-12"]);
    expect(jobs[0]).toMatchObject({ preferredStart: null, preferredEnd: null, estimatedDurationMin: null });
    expect(w.data.checklist.filter((c) => c.jobId === jobs[0]!.id)).toEqual([]);
    expect(plan.nextOn).toBe("2026-11-19");
  });

  it("generates nothing yet when the first date is beyond the lead time", async () => {
    const w = world();
    const plan = await recurrences.createPlan(w.ctx(w.owner), planInput(w, { starts_on: "2027-01-10" }));
    expect(plan).toMatchObject({ nextOn: "2027-01-10", jobCount: 0, lastOccurrence: null });
  });

  it("validates the plan and its references", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    await expect(recurrences.createPlan(w.ctx(w.tom), planInput(w))).rejects.toThrow(ForbiddenError);
    await expect(recurrences.createPlan(ctx, planInput(w, { site_id: w.otherSiteId }))).rejects.toThrow(
      "The site doesn't belong to this customer",
    );
    await expect(
      recurrences.createPlan(ctx, planInput(w, { customer_id: w.otherCustomerId, site_id: w.otherSiteId })),
    ).rejects.toThrow("The equipment isn't at this site");
    await expect(recurrences.createPlan(ctx, planInput(w, { service_type_id: w.siteId }))).rejects.toThrow(
      "Unknown service type",
    );
    await expect(recurrences.createPlan(ctx, planInput(w, { lead_member_id: w.siteId }))).rejects.toThrow(
      "Unknown member",
    );
    await expect(recurrences.createPlan(ctx, planInput(w, { window_minutes: null }))).rejects.toThrow(
      ValidationError,
    );
    await expect(
      recurrences.createPlan(ctx, planInput(w, { interval_unit: "year", interval_count: 11 })),
    ).rejects.toThrow("At most 10 for this unit");
    await expect(
      recurrences.createPlan(ctx, planInput(w, { starts_on: "2026-01-01", ends_on: "2025-12-31" })),
    ).rejects.toThrow("The end date must be on or after the start");
    await expect(
      recurrences.createPlan(ctx, planInput(w, { starts_on: "2026-01-01", ends_on: "2026-11-01" })),
    ).rejects.toThrow("The plan ends before its next visit");
    expect(opsState(w.data).plans).toEqual([]);
  });
});

describe("the generator (JOB-13)", () => {
  it("is idempotent and moves along with time", async () => {
    const w = world();
    const plan = await recurrences.createPlan(
      w.ctx(w.dispatcher),
      planInput(w, { interval_unit: "week", interval_count: 1, starts_on: "2026-11-12", lead_days: 7 }),
    );
    expect(planJobs(w, plan.id).map((j) => j.occurrenceDate)).toEqual(["2026-11-12"]);
    const deps = { store: w.store, now: day("2026-11-10") };
    expect(await recurrences.generateDue(deps)).toBe(0);

    // A lost advance: the occurrence already has a job, so nothing is created twice.
    opsState(w.data).plans[0]!.nextOn = "2026-11-12";
    expect(await recurrences.generateDue(deps)).toBe(0);
    expect(opsState(w.data).plans[0]!.nextOn).toBe("2026-11-19");

    // A week later, the next visit is inside the lead time; a missed day catches up.
    expect(await recurrences.generateDue({ store: w.store, now: day("2026-11-20") })).toBe(2);
    expect(planJobs(w, plan.id).map((j) => j.occurrenceDate)).toEqual([
      "2026-11-12",
      "2026-11-19",
      "2026-11-26",
    ]);
    expect(planJobs(w, plan.id).map((j) => j.number)).toEqual([1, 2, 3]);
  });

  it("skips paused and deleted plans, plans of deleted customers and plans past their end", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const weekly = { interval_unit: "week", interval_count: 1, starts_on: "2026-11-11", lead_days: 0 };
    const paused = await recurrences.pausePlan(
      ctx,
      (await recurrences.createPlan(ctx, planInput(w, weekly))).id,
    );
    const deleted = await recurrences.createPlan(ctx, planInput(w, weekly));
    await recurrences.deletePlan(ctx, deleted.id);
    const gone = await recurrences.createPlan(ctx, planInput(w, weekly));
    opsState(w.data).plans.find((p) => p.id === gone.id)!.customerId = w.otherCustomerId;
    w.data.customers[1]!.deleted = true;
    const locked = await recurrences.createPlan(ctx, planInput(w, weekly));
    opsState(w.data).locked.add(locked.id);
    const ending = await recurrences.createPlan(ctx, planInput(w, { ...weekly, ends_on: "2026-11-11" }));
    expect(w.data.jobs).toHaveLength(0);

    // Only the ending plan catches up on its last visit; after that it has ended.
    const deps = { store: w.store, now: day("2026-11-20") };
    expect(await recurrences.generateDue(deps)).toBe(1);
    expect(planJobs(w, ending.id).map((j) => j.occurrenceDate)).toEqual(["2026-11-11"]);
    expect(await recurrences.generateDue(deps)).toBe(0);
    expect(recurrences.planStatus((await recurrences.getPlan(ctx, ending.id))!)).toBe("ended");
    expect(await recurrences.generatePlan(deps, paused)).toBe(0);
  });
});

describe("editing a plan (JOB-13)", () => {
  it("continues a new rule after the dates that already have jobs", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const plan = await recurrences.createPlan(
      ctx,
      planInput(w, { interval_unit: "week", interval_count: 1, starts_on: "2026-11-10", lead_days: 7 }),
    );
    expect(planJobs(w, plan.id).map((j) => j.occurrenceDate)).toEqual(["2026-11-10", "2026-11-17"]);
    const updated = await recurrences.updatePlan(ctx, plan.id, {
      interval_unit: "day",
      interval_count: 3,
      starts_on: "2026-11-10",
      title: "Filter check",
    });
    // Every 3 days from 10 Nov, after the dates that have jobs (up to the 17th): next is the 19th, outside
    // the lead time. The existing jobs stay as they were.
    expect(planJobs(w, plan.id).map((j) => [j.occurrenceDate, j.title])).toEqual([
      ["2026-11-10", "Quarterly AC service"],
      ["2026-11-17", "Quarterly AC service"],
    ]);
    expect(updated.nextOn).toBe("2026-11-19");
    expect(updated.title).toBe("Filter check");
    // Changing only other fields keeps the next date.
    const renamed = await recurrences.updatePlan(ctx, plan.id, { title: "Filters", description: "" });
    expect(renamed).toMatchObject({ nextOn: "2026-11-19", description: null });
  });

  it("pauses, and resumes from today without the dates missed meanwhile", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const plan = await recurrences.createPlan(
      ctx,
      planInput(w, { interval_unit: "day", interval_count: 2, starts_on: "2026-11-10", lead_days: 1 }),
    );
    const paused = await recurrences.pausePlan(ctx, plan.id);
    expect(recurrences.planStatus(paused)).toBe("paused");
    expect(await recurrences.generateDue({ store: w.store, now: day("2026-11-16") })).toBe(0);
    const resumed = await recurrences.resumePlan(w.ctx(w.dispatcher, { now: day("2026-11-17") }), plan.id);
    expect(resumed.nextOn).toBe("2026-11-20");
    expect(planJobs(w, plan.id).map((j) => j.occurrenceDate)).toEqual(["2026-11-10", "2026-11-18"]);
    expect(recurrences.planStatus(resumed)).toBe("active");
  });

  it("can end a plan, and checks the combined values", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const plan = await recurrences.createPlan(ctx, planInput(w));
    const ended = await recurrences.updatePlan(ctx, plan.id, { ends_on: "2026-11-30" });
    expect(recurrences.planStatus(ended)).toBe("ended");
    expect(recurrences.upcomingDates(ended, "2026-11-10")).toEqual([]);
    await expect(recurrences.updatePlan(ctx, plan.id, { window_minutes: null })).rejects.toThrow(
      "Give the window's start and its length, or neither",
    );
    await expect(recurrences.updatePlan(ctx, plan.id, { window_start: null })).rejects.toThrow(
      ValidationError,
    );
    await expect(recurrences.updatePlan(ctx, plan.id, { ends_on: "2026-11-01" })).rejects.toThrow(
      "The end date must be on or after the start",
    );
    await expect(
      recurrences.updatePlan(ctx, plan.id, { interval_count: 15, ends_on: null }),
    ).resolves.toMatchObject({ intervalCount: 15 });
    await expect(recurrences.updatePlan(ctx, plan.id, { interval_unit: "year" })).rejects.toThrow(
      "The interval is too long",
    );
    await expect(recurrences.updatePlan(ctx, plan.id, { site_id: w.otherSiteId })).rejects.toThrow(
      "The site doesn't belong to this customer",
    );
    await expect(recurrences.updatePlan(ctx, "missing", { title: "x" })).rejects.toThrow(NotFoundError);
    await expect(recurrences.updatePlan(w.ctx(w.tom), plan.id, { title: "x" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("reports a plan deleted between reading and saving", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const plan = await recurrences.createPlan(ctx, planInput(w));
    const update = w.store.recurrences.update;
    w.store.recurrences.update = async () => null;
    await expect(recurrences.updatePlan(ctx, plan.id, { title: "x" })).rejects.toThrow(NotFoundError);
    w.store.recurrences.update = update;
  });

  it("deletes a plan and keeps the jobs it generated", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const plan = await recurrences.createPlan(ctx, planInput(w));
    await recurrences.deletePlan(ctx, plan.id);
    await expect(recurrences.getPlan(ctx, plan.id)).rejects.toThrow(NotFoundError);
    expect(planJobs(w, plan.id)).toHaveLength(1);
    await expect(recurrences.deletePlan(ctx, plan.id)).rejects.toThrow(NotFoundError);
  });
});

describe("reading plans", () => {
  it("lists a customer's plans with their status and next dates", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const a = await recurrences.createPlan(ctx, planInput(w));
    const b = await recurrences.createPlan(
      ctx,
      planInput(w, { starts_on: "2026-12-01", title: "Duct check" }),
    );
    await recurrences.pausePlan(ctx, b.id);
    const page = await recurrences.listPlans(ctx, { customer: w.customerId });
    expect(page.rows.map((p) => p.id)).toEqual([b.id, a.id]);
    const described = await recurrences.describePlans(ctx, page.rows);
    expect(described.map((p) => [p.status, p.upcoming])).toEqual([
      ["paused", []],
      ["active", ["2026-11-15", "2027-02-15", "2027-05-15", "2027-08-15", "2027-11-15"]],
    ]);
    const first = await recurrences.listPlans(ctx, { limit: 1 });
    expect(first.rows).toHaveLength(1);
    const second = await recurrences.listPlans(ctx, { limit: 1, cursor: first.nextCursor! });
    expect(second.rows.map((p) => p.id)).toEqual([a.id]);
    expect((await recurrences.listPlans(ctx, { active: "false" })).rows.map((p) => p.id)).toEqual([b.id]);
    expect((await recurrences.listPlans(ctx, undefined)).rows).toHaveLength(2);
    await expect(recurrences.listPlans(w.ctx(w.tom), {})).rejects.toThrow(ForbiddenError);
  });

  it("previews the next dates of a rule", async () => {
    const w = world();
    expect(
      await recurrences.previewDates(w.ctx(w.dispatcher), {
        interval_unit: "month",
        interval_count: 1,
        starts_on: "2026-01-31",
      }),
    ).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(
      await recurrences.previewDates(
        w.ctx(w.dispatcher),
        { interval_unit: "year", interval_count: 1, starts_on: "2026-12-01", ends_on: "2027-12-01" },
        10,
      ),
    ).toEqual(["2026-12-01", "2027-12-01"]);
    await expect(
      recurrences.previewDates(w.ctx(w.tom), {
        interval_unit: "day",
        interval_count: 1,
        starts_on: "2026-11-10",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});
