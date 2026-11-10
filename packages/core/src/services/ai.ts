import {
  AI_REVIEW_FIELDS,
  aiIntakeRequestSchema,
  aiOutcomeSchema,
  aiSettingsSchema,
  intakeDraftSchema,
  intakeModelOutputSchema,
  jobCreateSchema,
  jobReviewSchema,
  trimmed,
  type AiCustomerSuggestion,
  type AiOutcome,
  type AiReviewField,
  type IntakeDraft,
  type JobPriority,
} from "@fieldops/shared";
import { z } from "zod";
import { normalizeEmail, normalizePhone } from "../domain/contact";
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  UnavailableError,
  ValidationError,
} from "../domain/errors";
import { assertCan, can } from "../domain/permissions";
import type {
  AiLimits,
  IntakeCatalog,
  IntakeModel,
  IntakeModelResult,
  IntakePhoto,
  RateLimitStatus,
  StoreRunner,
  TxRunner,
} from "./ai-types";
import { getJob } from "./job-access";
import * as jobs from "./jobs";
import type { NewChecklistItem } from "./fieldwork-types";
import type { AttachmentRecord, ServiceContext, Store } from "./types";
import { parseInput } from "./validate";

// AI smart intake (AI-01) and its guardrails (§9.1, §9.7, PLT-04, SET-04).
//
// A draft takes two short transactions with the model call between them, so a slow model never holds a database
// connection: the first checks permissions, settings, the monthly quota and the rate limits and reads the
// catalog; the second validates the output, looks up matching customers and logs the call. Model output never
// changes a job until a person confirms it.

const HOUR = 3600;
const DAY = 24 * HOUR;
export const MAX_CHECKLIST_SUGGESTIONS = 5;
const MAX_QUESTIONS = 5;

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function nextMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** The organization's service types and skills: what the model may choose from. */
export async function intakeCatalog(store: Store): Promise<IntakeCatalog> {
  const [org, types, members] = await Promise.all([
    store.organization.get(),
    store.serviceTypes.list(),
    store.members.list(),
  ]);
  const skills = new Set<string>();
  for (const m of members) for (const s of m.skills) skills.add(s);
  for (const t of types) for (const s of t.requiredSkills) skills.add(s);
  return {
    organizationName: org.name,
    country: org.country,
    currency: org.currency,
    serviceTypes: types
      .filter((t) => t.active)
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        defaultDurationMin: t.defaultDurationMin,
        requiredSkills: t.requiredSkills,
      })),
    skills: [...skills].sort(),
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clip = (s: string, max: number) => s.trim().slice(0, max).trim();
const blankToNull = (s: string | null, max: number) => {
  const v = s === null ? "" : clip(s, max);
  return v === "" ? null : v;
};

/**
 * Validates the model's output and clamps it into a draft: the service type must be one of the catalog's (the
 * model can't invent ids), lists and texts are cut to size, the duration is rounded to 5 minutes, and every
 * confidence is between 0 and 1. Returns null when the output doesn't match the schema at all.
 */
export function sanitizeIntakeDraft(raw: unknown, catalog: IntakeCatalog): IntakeDraft | null {
  const parsed = intakeModelOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const o = parsed.data;
  const serviceType = catalog.serviceTypes.find((t) => t.id === o.service_type_id) ?? null;
  const duration =
    o.estimated_duration_min === null
      ? null
      : Math.min(24 * 60, Math.max(5, Math.round(o.estimated_duration_min / 5) * 5));
  const list = (items: string[], max: number) =>
    [...new Set(items.map((i) => clip(i, 200)).filter(Boolean))].slice(0, max);
  const title = clip(o.title, 200);
  return {
    language: o.language,
    title: title || "Service request",
    service_type_id: serviceType?.id ?? null,
    priority: o.priority,
    priority_reason: clip(o.priority_reason, 300),
    summary: clip(o.summary, 2000),
    checklist: list(o.checklist, MAX_CHECKLIST_SUGGESTIONS),
    estimated_duration_min: duration ?? serviceType?.defaultDurationMin ?? null,
    equipment: {
      type: blankToNull(o.equipment.type, 100),
      brand: blankToNull(o.equipment.brand, 100),
      model: blankToNull(o.equipment.model, 100),
    },
    contact: {
      name: blankToNull(o.contact.name, 200),
      phone: blankToNull(o.contact.phone, 40),
      email: blankToNull(o.contact.email, 200),
      address: blankToNull(o.contact.address, 300),
    },
    questions: list(o.questions, MAX_QUESTIONS),
    confidence: {
      title: title ? clamp01(o.confidence.title) : 0,
      service_type: serviceType ? clamp01(o.confidence.service_type) : 0,
      priority: clamp01(o.confidence.priority),
      summary: clamp01(o.confidence.summary),
      estimated_duration: clamp01(o.confidence.estimated_duration),
      equipment: clamp01(o.confidence.equipment),
      contact: clamp01(o.confidence.contact),
    },
  };
}

/**
 * Existing customers that match the contact details in a draft, through ordinary database search: email or phone
 * first, then the name. The model never picks a customer itself.
 */
export async function suggestCustomers(
  store: Store,
  contact: IntakeDraft["contact"],
  country: string,
): Promise<AiCustomerSuggestion[]> {
  const email = normalizeEmail(contact.email);
  const phone = normalizePhone(contact.phone, country);
  const out: AiCustomerSuggestion[] = [];
  if (email || phone) {
    const matches = await store.customers.findDuplicates({
      emails: email ? [email] : [],
      phones: phone ? [phone] : [],
    });
    for (const m of matches) out.push({ id: m.id, name: m.name, matched_on: m.matchedOn });
  }
  if (out.length === 0 && contact.name && contact.name.length >= 3) {
    const byName = await store.customers.list({ q: contact.name, sort: "name", limit: 3 });
    for (const c of byName.rows) out.push({ id: c.id, name: c.name, matched_on: "name" });
  }
  return out.filter((c, i) => out.findIndex((x) => x.id === c.id) === i).slice(0, 3);
}

// ------------------------------------------------------------------ guardrails

/** AI on for the organization (SET-04) and configured on this server. */
async function assertAiAvailable(store: Store, model: IntakeModel) {
  const org = await store.organization.get();
  if (!org.settings.ai.enabled) {
    throw new UnavailableError("AI features are turned off for this organization", { reason: "disabled" });
  }
  if (model.provider === "unavailable") {
    throw new UnavailableError("AI isn't configured on this server", { reason: "not_configured" });
  }
  return org;
}

async function assertUnderQuota(store: Store, quota: number, now: Date) {
  const used = await store.ai.countSince(monthStart(now));
  if (used >= quota) {
    throw new RateLimitedError("This month's AI quota is used up", {
      scope: "monthly_quota",
      limit: quota,
      resetAt: nextMonth(now),
    });
  }
  return used;
}

/**
 * Counts this request against every limit that applies and throws on the first one exceeded (PLT-04). The
 * counters live in the same transaction, so a rejected request doesn't count. Returns the tightest limit for the
 * RateLimit-* headers.
 */
export async function applyAiRateLimits(
  ctx: ServiceContext,
  guard: { ip: string | null; limits: AiLimits },
): Promise<RateLimitStatus | null> {
  const rules: { key: string; scope: string; limit: number; window: number }[] = [];
  const { limits } = guard;
  if (limits.perUserPerHour > 0)
    rules.push({
      key: `ai:user:${ctx.actor.userId}`,
      scope: "user",
      limit: limits.perUserPerHour,
      window: HOUR,
    });
  if (limits.perVisitorPerDay && guard.ip)
    rules.push({ key: `ai:ip:${guard.ip}`, scope: "visitor", limit: limits.perVisitorPerDay, window: DAY });
  if (limits.globalPerDay > 0)
    rules.push({ key: "ai:global", scope: "global", limit: limits.globalPerDay, window: DAY });
  let tightest: RateLimitStatus | null = null;
  for (const r of rules) {
    const hit = await ctx.store.ai.hitRateLimit(r.key, r.window, ctx.now);
    if (hit.count > r.limit) {
      const message =
        r.scope === "global"
          ? "The AI budget for today is used up. Try again tomorrow."
          : "Too many AI drafts. Wait a little and try again.";
      throw new RateLimitedError(message, { scope: r.scope, limit: r.limit, resetAt: hit.resetAt });
    }
    const status = { limit: r.limit, remaining: r.limit - hit.count, resetAt: hit.resetAt };
    if (!tightest || status.remaining < tightest.remaining) tightest = status;
  }
  return tightest;
}

// ------------------------------------------------------------------ dispatcher intake (new job form, API)

export interface IntakeSuccess {
  ok: true;
  interactionId: string;
  draft: IntakeDraft;
  customerSuggestions: AiCustomerSuggestion[];
  model: string;
  quota: { used: number; limit: number };
  rateLimit: RateLimitStatus | null;
}

export interface IntakeFailure {
  ok: false;
  interactionId: string;
  reason: "refused" | "failed";
  model: string;
  quota: { used: number; limit: number };
  rateLimit: RateLimitStatus | null;
}

export type IntakeResult = IntakeSuccess | IntakeFailure;

const usageColumns = (r: IntakeModelResult) => ({
  model: r.model,
  inputTokens: r.usage.inputTokens,
  outputTokens: r.usage.outputTokens,
  cacheReadTokens: r.usage.cacheReadTokens,
  cacheWriteTokens: r.usage.cacheWriteTokens,
  latencyMs: Math.round(r.latencyMs),
  stopReason: r.stopReason,
});

/**
 * Drafts a job from a customer's message and up to 3 photos (AI-01). Office roles with `ai.use`; checks the
 * organization's AI setting and monthly quota and the rate limits first. A refusal or an error still returns a
 * result (with `ok: false`), and the form stays available.
 */
export async function draftIntake(
  run: TxRunner,
  model: IntakeModel,
  raw: unknown,
  guard: { ip: string | null; limits: AiLimits },
): Promise<IntakeResult> {
  const prep = await run(async (ctx) => {
    assertCan(ctx.actor, "jobs.create");
    assertCan(ctx.actor, "ai.use");
    const input = parseInput(aiIntakeRequestSchema, raw);
    const org = await assertAiAvailable(ctx.store, model);
    const used = await assertUnderQuota(ctx.store, org.settings.ai.monthlyQuota, ctx.now);
    const rateLimit = await applyAiRateLimits(ctx, guard);
    const catalog = await intakeCatalog(ctx.store);
    return { input, catalog, rateLimit, quota: { used: used + 1, limit: org.settings.ai.monthlyQuota } };
  });
  const photos: IntakePhoto[] = prep.input.photos.map((p) => ({ mediaType: p.media_type, data: p.data }));
  const result = await model.draft({ message: prep.input.message, photos, catalog: prep.catalog });
  return run(async (ctx) => {
    const draft = result.kind === "draft" ? sanitizeIntakeDraft(result.output, prep.catalog) : null;
    const outcome: AiOutcome = draft ? "drafted" : result.kind === "refused" ? "refused" : "failed";
    const error =
      result.kind === "draft" ? (draft ? null : "The output didn't match the schema") : result.error;
    const { id } = await ctx.store.ai.logInteraction({
      userId: ctx.actor.userId,
      jobId: null,
      feature: "intake",
      ...usageColumns(result),
      outcome,
      output: draft,
      error,
    });
    const common = { interactionId: id, model: result.model, quota: prep.quota, rateLimit: prep.rateLimit };
    if (!draft) return { ok: false, reason: outcome === "refused" ? "refused" : "failed", ...common };
    const org = await ctx.store.organization.get();
    const customerSuggestions = await suggestCustomers(ctx.store, draft.contact, org.country);
    return { ok: true, draft, customerSuggestions, ...common };
  });
}

/** Records what the dispatcher did with a draft: accepted as is, edited, or discarded (§9.1). */
export async function recordOutcome(ctx: ServiceContext, interactionId: string, raw: unknown) {
  assertCan(ctx.actor, "ai.use");
  const { outcome } = parseInput(aiOutcomeSchema, raw);
  const interaction = await ctx.store.ai.getInteraction(interactionId);
  if (!interaction) throw new NotFoundError("AI draft");
  if (!(await ctx.store.ai.setOutcome(interaction.id, outcome))) {
    throw new ConflictError("This draft was already used");
  }
  return { id: interaction.id, outcome };
}

const draftJobSchema = z.object({
  interaction_id: z.uuid(),
  /** Suggested checklist items the dispatcher kept; added after the service type's own items. */
  checklist: z.array(trimmed(200).min(1)).max(MAX_CHECKLIST_SUGGESTIONS).default([]),
  job: jobCreateSchema,
});

/** The fields a dispatcher can change between the draft and the saved job. */
function differs(
  draft: IntakeDraft,
  job: {
    title: string;
    serviceTypeId: string | null;
    priority: JobPriority;
    estimatedDurationMin: number | null;
  },
) {
  return (
    draft.title !== job.title ||
    draft.service_type_id !== job.serviceTypeId ||
    draft.priority !== job.priority ||
    (draft.estimated_duration_min ?? null) !== (job.estimatedDurationMin ?? null)
  );
}

/**
 * Saves the job a dispatcher confirmed from a draft, in one transaction: the job (source "ai_intake"), the kept
 * checklist suggestions, and the draft's outcome, "accepted" when the saved fields match the draft and "edited"
 * otherwise. The dispatcher just reviewed it, so the job doesn't need another review.
 */
export async function createJobFromDraft(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "ai.use");
  const input = parseInput(draftJobSchema, raw);
  const interaction = await ctx.store.ai.getInteraction(input.interaction_id);
  if (!interaction || interaction.feature !== "intake") throw new NotFoundError("AI draft");
  if (interaction.outcome !== "drafted") throw new ConflictError("This draft was already used");
  const job = await jobs.createJob(ctx, { ...input.job, source: "ai_intake" });
  if (input.checklist.length) await appendChecklist(ctx, job.id, input.checklist);
  const draft = intakeDraftSchema.safeParse(interaction.output);
  const outcome: AiOutcome = draft.success && !differs(draft.data, job) ? "accepted" : "edited";
  await ctx.store.ai.setOutcome(interaction.id, outcome, job.id);
  return { job, outcome };
}

/** Adds optional checkbox items after the job's current checklist. */
async function appendChecklist(ctx: ServiceContext, jobId: string, labels: string[]) {
  const current = await ctx.store.checklist.list(jobId);
  const existing = new Set(current.map((i) => i.label.toLowerCase()));
  const kept: NewChecklistItem[] = current.map((i, position) => ({
    position,
    label: i.label,
    kind: i.kind,
    unit: i.unit,
    required: i.required,
  }));
  const added = labels.filter((l) => !existing.has(l.toLowerCase()));
  if (added.length === 0) return 0;
  if (current.some((i) => i.doneAt)) {
    throw new ConflictError("Work on the checklist has started; add items from the checklist itself");
  }
  await ctx.store.checklist.replace(jobId, [
    ...kept,
    ...added.map((label, i) => ({
      position: kept.length + i,
      label,
      kind: "checkbox" as const,
      unit: null,
      required: false,
    })),
  ]);
  return added.length;
}

// ------------------------------------------------------------------ portal requests ("Needs review")

/** Draft photos of a portal request: ready image attachments, at most 3. */
export function draftablePhotos(attachments: AttachmentRecord[]): AttachmentRecord[] {
  return attachments
    .filter((a) => a.kind === "photo" && a.status === "ready" && a.mimeType.startsWith("image/"))
    .slice(0, 3);
}

/**
 * Drafts one portal request the worker claimed (status "drafting"). Skips it when AI is off, not configured or
 * over the monthly quota; logs the call against the job either way it ends. Returns the new status.
 */
export async function draftPortalJob(
  run: StoreRunner,
  model: IntakeModel,
  jobId: string,
  loadPhotos: (attachments: AttachmentRecord[]) => Promise<IntakePhoto[]>,
  now: Date,
): Promise<"drafted" | "failed" | "skipped" | null> {
  const prep = await run(async (store) => {
    const job = await store.jobs.get(jobId);
    if (!job || job.aiStatus !== "drafting") return null;
    const org = await store.organization.get();
    const used = await store.ai.countSince(monthStart(now));
    if (
      !org.settings.ai.enabled ||
      model.provider === "unavailable" ||
      used >= org.settings.ai.monthlyQuota
    ) {
      await store.ai.setJobStatus(jobId, "skipped");
      return "skipped" as const;
    }
    const [catalog, attachments] = await Promise.all([intakeCatalog(store), store.attachments.list(jobId)]);
    const message = [job.title, job.description].filter(Boolean).join("\n\n");
    return { message, catalog, photos: draftablePhotos(attachments) };
  });
  if (prep === null || prep === "skipped") return prep;
  const photos = await loadPhotos(prep.photos).catch(() => []);
  const result = await model.draft({ message: prep.message, photos, catalog: prep.catalog });
  return run(async (store) => {
    const job = await store.jobs.get(jobId);
    if (!job) return null;
    const draft = result.kind === "draft" ? sanitizeIntakeDraft(result.output, prep.catalog) : null;
    await store.ai.logInteraction({
      userId: null,
      jobId,
      feature: "intake",
      ...usageColumns(result),
      outcome: draft ? "drafted" : result.kind === "refused" ? "refused" : "failed",
      output: draft,
      error: result.kind === "draft" ? (draft ? null : "The output didn't match the schema") : result.error,
    });
    const status = draft ? "drafted" : "failed";
    await store.ai.setJobStatus(jobId, status);
    return status;
  });
}

/** A portal request with its AI draft, for the review panel on the job page. Office roles. */
export async function getReview(ctx: ServiceContext, jobId: string) {
  assertCan(ctx.actor, "jobs.update");
  const job = await getJob(ctx, jobId);
  const [latest, items] = await Promise.all([
    ctx.store.ai.latestDraft(job.id),
    ctx.store.checklist.list(job.id),
  ]);
  const parsed = latest ? intakeDraftSchema.safeParse(latest.output) : null;
  return {
    job,
    interactionId: latest?.id ?? null,
    outcome: latest?.outcome ?? null,
    draft: parsed?.success ? parsed.data : null,
    /** The job's current checklist labels: suggestions already on it aren't offered again. */
    checklist: items.map((i) => i.label),
  };
}

/** Which draft fields would change the job: the ones worth offering. */
export function reviewChanges(
  draft: IntakeDraft,
  job: {
    title: string;
    serviceTypeId: string | null;
    priority: JobPriority;
    estimatedDurationMin: number | null;
  },
  checklist: string[] = [],
): AiReviewField[] {
  const existing = new Set(checklist.map((l) => l.toLowerCase()));
  return AI_REVIEW_FIELDS.filter((f) => {
    switch (f) {
      case "title":
        return draft.title !== job.title;
      case "service_type_id":
        return draft.service_type_id !== null && draft.service_type_id !== job.serviceTypeId;
      case "priority":
        return draft.priority !== job.priority;
      case "estimated_duration_min":
        return (
          draft.estimated_duration_min !== null && draft.estimated_duration_min !== job.estimatedDurationMin
        );
      case "checklist":
        return draft.checklist.some((l) => !existing.has(l.toLowerCase()));
    }
  });
}

/**
 * Reviews a portal request (AI-01): copies the chosen draft fields onto the job through the ordinary job update
 * (so priority changes recompute the SLA, and the timeline records the edit), then, with `confirm`, clears
 * "Needs review". The customer's original request stays in the description.
 */
export async function reviewJob(ctx: ServiceContext, jobId: string, raw: unknown) {
  assertCan(ctx.actor, "jobs.update");
  const input = parseInput(jobReviewSchema, raw);
  const job = await getJob(ctx, jobId);
  if (!job.needsReview) throw new ConflictError("This request was already reviewed");
  const review = await getReview(ctx, job.id);
  if (input.apply.length && !review.draft) {
    throw new ValidationError("There is no AI draft to apply", [{ path: "apply", message: "No AI draft" }]);
  }
  const offered = review.draft ? reviewChanges(review.draft, job, review.checklist) : [];
  const applied = input.apply.filter((f) => offered.includes(f));
  const draft = review.draft;
  if (draft && applied.length) {
    const patch: Record<string, unknown> = {};
    if (applied.includes("title")) patch.title = draft.title;
    if (applied.includes("service_type_id")) patch.service_type_id = draft.service_type_id;
    if (applied.includes("priority")) patch.priority = draft.priority;
    if (applied.includes("estimated_duration_min"))
      patch.estimated_duration_min = draft.estimated_duration_min;
    if (Object.keys(patch).length) await jobs.updateJob(ctx, job.id, patch);
    if (applied.includes("checklist")) await appendChecklist(ctx, job.id, draft.checklist);
  }
  if (input.confirm) {
    await ctx.store.jobs.update(job.id, {
      needsReview: false,
      aiDrafted: job.aiDrafted || applied.length > 0,
    });
  }
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "reviewed",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: { applied, confirmed: input.confirm },
  });
  if (review.interactionId && review.outcome === "drafted" && (input.confirm || applied.length)) {
    const outcome: AiOutcome =
      applied.length === 0 ? "discarded" : applied.length === offered.length ? "accepted" : "edited";
    await ctx.store.ai.setOutcome(review.interactionId, outcome);
  }
  return { job: await getJob(ctx, job.id), applied };
}

/**
 * Whether the new job form can offer an AI draft, and why not otherwise, with this month's quota. For office
 * roles; others get `available: false` without a reason.
 */
export async function intakeStatus(ctx: ServiceContext, provider: IntakeModel["provider"]) {
  const org = await ctx.store.organization.get();
  const limit = org.settings.ai.monthlyQuota;
  const allowed = can(ctx.actor, "jobs.create") && can(ctx.actor, "ai.use");
  if (!allowed) return { available: false, reason: null, used: 0, limit };
  const used = await ctx.store.ai.countSince(monthStart(ctx.now));
  const reason = !org.settings.ai.enabled
    ? ("disabled" as const)
    : provider === "unavailable"
      ? ("not_configured" as const)
      : used >= limit
        ? ("quota" as const)
        : null;
  return { available: reason === null, reason, used, limit };
}

// ------------------------------------------------------------------ settings (SET-04)

export async function getAiSettings(ctx: ServiceContext, provider: IntakeModel["provider"]) {
  assertCan(ctx.actor, "ai.manage");
  const org = await ctx.store.organization.get();
  const usage = await ctx.store.ai.usageSince(monthStart(ctx.now));
  const decided = usage.outcomes.accepted + usage.outcomes.edited + usage.outcomes.discarded;
  return {
    enabled: org.settings.ai.enabled,
    monthlyQuota: org.settings.ai.monthlyQuota,
    provider,
    usage,
    /** Share of decided drafts that were saved as drafted or with edits; null before any decision. */
    acceptanceRate: decided ? (usage.outcomes.accepted + usage.outcomes.edited) / decided : null,
  };
}

export async function updateAiSettings(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "ai.manage");
  const input = parseInput(aiSettingsSchema, raw);
  const current = await ctx.store.organization.get();
  const org = await ctx.store.organization.update({
    settings: { ...current.settings, ai: { enabled: input.enabled, monthlyQuota: input.monthly_quota } },
  });
  return org.settings.ai;
}
