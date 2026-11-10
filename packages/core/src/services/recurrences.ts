import {
  MAX_INTERVAL_COUNT,
  PLAN_PREVIEW_COUNT,
  recurrenceCreateSchema,
  recurrenceListQuerySchema,
  recurrenceRuleSchema,
  recurrenceUpdateSchema,
  type RecurrenceStatus,
} from "@fieldops/shared";
import { hhmmToMinutes, localDateOf, shiftDate, zonedInstant } from "../domain/availability";
import { NotFoundError, ValidationError } from "../domain/errors";
import { assertCan } from "../domain/permissions";
import {
  indexOnOrAfter,
  nextOccurrence,
  occurrenceAfter,
  occurrenceAt,
  occurrencesBetween,
  upcomingOccurrences,
  type RecurrenceRule,
} from "../domain/recurrence";
import { slaClockStart } from "../domain/sla";
import { itemsFromTemplate } from "./checklist";
import type { NewRecurrence, RecurrencePatch, RecurrenceRecord, RecurrenceView } from "./recurrence-types";
import { slaForNewJob } from "./sla";
import { parseInput } from "./validate";
import type { OrganizationRecord, ServiceContext, Store } from "./types";

// Maintenance plans (JOB-13): a recurrence rule on a customer's site that creates its jobs a set number of days
// ahead. The plan's lead technician is only suggested: generated jobs arrive unassigned (status New) with the
// preferred window, so the dispatcher assigns them with the usual conflict checks (working hours, time off and
// skills can change between generation and the visit), and nobody is notified weeks ahead.

type Deps = Pick<ServiceContext, "store" | "now">;

export function ruleOf(
  plan: Pick<RecurrenceRecord, "intervalUnit" | "intervalCount" | "startsOn" | "endsOn">,
) {
  return {
    unit: plan.intervalUnit,
    count: plan.intervalCount,
    startsOn: plan.startsOn,
    endsOn: plan.endsOn,
  } satisfies RecurrenceRule;
}

/** Active, paused by the office, or past its end date. */
export function planStatus(plan: Pick<RecurrenceRecord, "active" | "nextOn" | "endsOn">): RecurrenceStatus {
  if (plan.endsOn !== null && plan.nextOn > plan.endsOn) return "ended";
  return plan.active ? "active" : "paused";
}

/** The next visit dates of a plan from `today` (generated or not); none while paused or after its end. */
export function upcomingDates(plan: RecurrenceRecord, today: string, count = PLAN_PREVIEW_COUNT): string[] {
  if (planStatus(plan) !== "active") return [];
  return upcomingOccurrences(ruleOf(plan), today, count);
}

/** The organization's local date at `now`. */
async function today(deps: Deps): Promise<{ org: OrganizationRecord; date: string }> {
  const org = await deps.store.organization.get();
  return { org, date: localDateOf(deps.now, org.timezone) };
}

/** Where generation resumes: the first occurrence from `today` that has no job yet, possibly past the end. */
function resumeFrom(rule: RecurrenceRule, date: string, lastOccurrence: string | null): string {
  const from = lastOccurrence && lastOccurrence >= date ? shiftDate(lastOccurrence, 1) : date;
  return occurrenceAt(rule, indexOnOrAfter(rule, from));
}

// ------------------------------------------------------------------ reading

export async function listPlans(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "recurrences.manage");
  const q = parseInput(recurrenceListQuerySchema, raw ?? {});
  return ctx.store.recurrences.list({
    customerId: q.customer,
    active: q.active,
    limit: q.limit,
    cursor: q.cursor,
  });
}

export async function getPlan(ctx: ServiceContext, id: string): Promise<RecurrenceView> {
  assertCan(ctx.actor, "recurrences.manage");
  const plan = await ctx.store.recurrences.get(id);
  if (!plan) throw new NotFoundError("Maintenance plan");
  return plan;
}

/** A plan with its next visit dates, as the API and the customer page show it. */
export async function describePlans(ctx: ServiceContext, plans: RecurrenceView[]) {
  const { date } = await today(ctx);
  return plans.map((p) => ({ ...p, status: planStatus(p), upcoming: upcomingDates(p, date) }));
}

// ------------------------------------------------------------------ writing

/** Checks that the site, equipment, service type and technician belong together and to the organization. */
async function checkReferences(
  store: Store,
  plan: Pick<RecurrenceRecord, "customerId" | "siteId" | "equipmentId" | "serviceTypeId" | "leadMemberId">,
) {
  const site = await store.sites.get(plan.siteId);
  if (!site || site.customerId !== plan.customerId) {
    throw new ValidationError("The site doesn't belong to this customer", [
      { path: "site_id", message: "Choose a site of this customer" },
    ]);
  }
  if (plan.equipmentId) {
    const eq = await store.equipment.get(plan.equipmentId);
    if (!eq || eq.siteId !== site.id) {
      throw new ValidationError("The equipment isn't at this site", [
        { path: "equipment_id", message: "Not at this site" },
      ]);
    }
  }
  if (plan.serviceTypeId && !(await store.serviceTypes.get(plan.serviceTypeId))) {
    throw new ValidationError("Unknown service type", [
      { path: "service_type_id", message: "Unknown service type" },
    ]);
  }
  if (plan.leadMemberId && !(await store.members.get(plan.leadMemberId))) {
    throw new ValidationError("Unknown member", [{ path: "lead_member_id", message: "Unknown member" }]);
  }
}

/** Rules that need the stored values too: an update may change one side of a pair. */
function checkCombined(plan: Omit<RecurrenceRecord, "id" | "createdAt" | "updatedAt">) {
  if ((plan.windowStart === null) !== (plan.windowMinutes === null)) {
    throw new ValidationError("Give the window's start and its length, or neither", [
      { path: plan.windowStart === null ? "window_start" : "window_minutes", message: "Required" },
    ]);
  }
  if (plan.endsOn !== null && plan.endsOn < plan.startsOn) {
    throw new ValidationError("The end date must be on or after the start", [
      { path: "ends_on", message: "On or after the start date" },
    ]);
  }
  if (plan.intervalCount > MAX_INTERVAL_COUNT[plan.intervalUnit]) {
    throw new ValidationError("The interval is too long", [
      { path: "interval_count", message: `At most ${MAX_INTERVAL_COUNT[plan.intervalUnit]} for this unit` },
    ]);
  }
}

export async function createPlan(ctx: ServiceContext, raw: unknown): Promise<RecurrenceView> {
  assertCan(ctx.actor, "recurrences.manage");
  const input = parseInput(recurrenceCreateSchema, raw);
  const { org, date } = await today(ctx);
  const rule: RecurrenceRule = {
    unit: input.interval_unit,
    count: input.interval_count,
    startsOn: input.starts_on,
    endsOn: input.ends_on ?? null,
  };
  // A plan that starts in the past begins with its first date from today: no backlog of past visits.
  const nextOn = nextOccurrence(rule, date);
  if (!nextOn) {
    throw new ValidationError("The plan ends before its next visit", [
      { path: "ends_on", message: "No visit date is left before this end date" },
    ]);
  }
  const data: NewRecurrence = {
    customerId: input.customer_id,
    siteId: input.site_id,
    equipmentId: input.equipment_id ?? null,
    serviceTypeId: input.service_type_id ?? null,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    intervalUnit: rule.unit,
    intervalCount: rule.count,
    startsOn: rule.startsOn,
    endsOn: rule.endsOn,
    windowStart: input.window_start ?? null,
    windowMinutes: input.window_minutes ?? null,
    leadDays: input.lead_days,
    leadMemberId: input.lead_member_id ?? null,
    active: true,
    createdBy: ctx.actor.userId,
    nextOn,
  };
  await checkReferences(ctx.store, data);
  const plan = await ctx.store.recurrences.create(data);
  await generatePlan(ctx, plan, { org, date });
  return (await ctx.store.recurrences.get(plan.id))!;
}

/**
 * Edits a plan, pauses it (`active: false`) or resumes it (`active: true`). A new rule, or a resume, continues
 * from today after the dates that already have jobs: occurrences missed while paused aren't created. Other
 * fields apply to the jobs generated from now on; existing jobs keep theirs.
 */
export async function updatePlan(ctx: ServiceContext, id: string, raw: unknown): Promise<RecurrenceView> {
  assertCan(ctx.actor, "recurrences.manage");
  const input = parseInput(recurrenceUpdateSchema, raw ?? {});
  const current = await getPlan(ctx, id);
  const patch: RecurrencePatch = {};
  const set = <K extends keyof RecurrencePatch>(key: K, value: RecurrencePatch[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };
  set("siteId", input.site_id);
  set("equipmentId", input.equipment_id);
  set("serviceTypeId", input.service_type_id);
  set("title", input.title);
  if (input.description !== undefined) patch.description = input.description ?? null;
  set("priority", input.priority);
  set("intervalUnit", input.interval_unit);
  set("intervalCount", input.interval_count);
  set("startsOn", input.starts_on);
  set("endsOn", input.ends_on);
  set("windowStart", input.window_start);
  set("windowMinutes", input.window_minutes);
  set("leadDays", input.lead_days);
  set("leadMemberId", input.lead_member_id);
  set("active", input.active);
  const merged = { ...current, ...patch };
  checkCombined(merged);
  if (
    patch.siteId !== undefined ||
    patch.equipmentId !== undefined ||
    patch.serviceTypeId !== undefined ||
    patch.leadMemberId !== undefined
  ) {
    await checkReferences(ctx.store, merged);
  }

  const ruleChanged = (["intervalUnit", "intervalCount", "startsOn", "endsOn"] as const).some(
    (k) => patch[k] !== undefined && patch[k] !== current[k],
  );
  const resumed = patch.active === true && !current.active;
  if (ruleChanged || resumed) {
    const { date } = await today(ctx);
    patch.nextOn = resumeFrom(ruleOf(merged), date, current.lastOccurrence);
  }
  const updated = await ctx.store.recurrences.update(current.id, patch);
  if (!updated) throw new NotFoundError("Maintenance plan");
  await generatePlan(ctx, updated);
  return (await ctx.store.recurrences.get(current.id))!;
}

export const pausePlan = (ctx: ServiceContext, id: string) => updatePlan(ctx, id, { active: false });
export const resumePlan = (ctx: ServiceContext, id: string) => updatePlan(ctx, id, { active: true });

/** Deletes a plan. The jobs it already generated stay, with their link to it. */
export async function deletePlan(ctx: ServiceContext, id: string): Promise<void> {
  const plan = await getPlan(ctx, id);
  await ctx.store.recurrences.softDelete(plan.id);
}

/** The next dates a rule would give from today, for a preview before saving. */
export async function previewDates(ctx: ServiceContext, raw: unknown, count = PLAN_PREVIEW_COUNT) {
  assertCan(ctx.actor, "recurrences.manage");
  const input = parseInput(recurrenceRuleSchema, raw);
  const { date } = await today(ctx);
  return upcomingOccurrences(
    {
      unit: input.interval_unit,
      count: input.interval_count,
      startsOn: input.starts_on,
      endsOn: input.ends_on ?? null,
    },
    date,
    count,
  );
}

// ------------------------------------------------------------------ generator

/**
 * Creates the jobs of every occurrence of an active plan up to today + its lead days, then moves its next
 * date past them. Each job is built like `createJob`: service type duration and checklist, SLA deadlines (the
 * clock starts on the visit date), the preferred window in the organization's time zone, source "recurring".
 * Idempotent: occurrences that already have a job are skipped (and the database has a unique index on plan and
 * date). Returns the number of jobs created.
 */
export async function generatePlan(
  deps: Deps,
  plan: RecurrenceRecord,
  at?: { org: OrganizationRecord; date: string },
): Promise<number> {
  if (!plan.active) return 0;
  const { org, date } = at ?? (await today(deps));
  const rule = ruleOf(plan);
  const dates = occurrencesBetween(rule, plan.nextOn, shiftDate(date, plan.leadDays));
  if (dates.length === 0) return 0;
  const existing = new Set(await deps.store.recurrences.occurrencesWithJobs(plan.id, plan.nextOn));
  const st = plan.serviceTypeId ? await deps.store.serviceTypes.get(plan.serviceTypeId) : null;
  let created = 0;
  for (const occurrence of dates) {
    if (existing.has(occurrence)) continue;
    await createOccurrence(deps, org, plan, occurrence, st);
    created += 1;
  }
  await deps.store.recurrences.advance(plan.id, occurrenceAfter(rule, dates.at(-1)!));
  return created;
}

async function createOccurrence(
  deps: Deps,
  org: OrganizationRecord,
  plan: RecurrenceRecord,
  occurrence: string,
  st: Awaited<ReturnType<Store["serviceTypes"]["get"]>>,
) {
  const { store } = deps;
  const start =
    plan.windowStart !== null
      ? zonedInstant(occurrence, hhmmToMinutes(plan.windowStart), org.timezone)
      : null;
  const end = start && plan.windowMinutes ? new Date(start.getTime() + plan.windowMinutes * 60_000) : null;
  const number = await store.jobs.nextNumber();
  const clock = slaClockStart({ createdAt: deps.now, occurrenceDate: occurrence }, org.timezone);
  const job = await store.jobs.create({
    number,
    customerId: plan.customerId,
    siteId: plan.siteId,
    equipmentId: plan.equipmentId,
    serviceTypeId: st ? st.id : null,
    title: plan.title,
    description: plan.description,
    priority: plan.priority,
    source: "recurring",
    preferredStart: start,
    preferredEnd: end,
    estimatedDurationMin: st?.defaultDurationMin ?? null,
    aiDrafted: false,
    needsReview: false,
    createdBy: null,
    recurrenceId: plan.id,
    occurrenceDate: occurrence,
    ...(await slaForNewJob(deps, plan.priority, clock)),
  });
  await store.jobs.addEvent({
    jobId: job.id,
    type: "created",
    fromStatus: null,
    toStatus: "new",
    actorUserId: null,
    payload: {
      source: "recurring",
      recurrence_id: plan.id,
      plan_title: plan.title,
      occurrence_date: occurrence,
    },
  });
  if (st) await store.checklist.replace(job.id, itemsFromTemplate(st.checklistTemplate));
}

/** The generator's pass for one organization: every plan due within its lead days. Returns jobs created. */
export async function generateDue(deps: Deps): Promise<number> {
  const at = await today(deps);
  let created = 0;
  for (const plan of await deps.store.recurrences.due(at.date)) created += await generatePlan(deps, plan, at);
  return created;
}
