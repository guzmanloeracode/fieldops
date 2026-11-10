import {
  MAX_REPORT_AI_PHOTOS,
  MAX_REPORT_TEXT,
  REPORT_LINK_DAYS,
  reportModelOutputSchema,
  reportSendSchema,
  reportUpdateSchema,
  type AiOutcome,
  type Locale,
} from "@fieldops/shared";
import { localDateString } from "../domain/date-range";
import { ConflictError, NotFoundError, PreconditionFailedError, ValidationError } from "../domain/errors";
import { formatJobNumber } from "../domain/numbering";
import { assertCan, can } from "../domain/permissions";
import { applyAiRateLimits, assertAiAvailable, assertUnderQuota, monthStart } from "./ai";
import type { AiLimits, IntakePhoto, RateLimitStatus, StoreRunner, TxRunner } from "./ai-types";
import type { ChecklistItemRecord } from "./fieldwork-types";
import { getJob, isAssigned } from "./job-access";
import type { PortalContext } from "./portal-types";
import type {
  ReportChecklistLine,
  ReportDocumentData,
  ReportDraft,
  ReportModel,
  ReportModelInput,
  ReportModelResult,
  ReportSendDeps,
  ServiceReportPatch,
  ServiceReportRecord,
} from "./report-types";
import type { AttachmentRecord, JobView, OrganizationRecord, ServiceContext, Store } from "./types";
import { parseInput } from "./validate";

// Service reports (AI-03, FIN-04, POR-04, §8.7 "Job completed → customer").
//
// - Completing a job creates its report (one per job) in the customer's language, prefilled from the checklist,
//   the notes for the customer and the parts used, so it can be sent even without AI. With AI on and quota left
//   it is "pending": the worker drafts it, or someone presses "Draft with AI" (the release E2E has no worker).
// - The model only sees notes marked for the customer; internal notes never leave the database (§9.1, §13).
// - A draft never overwrites a person's edits: the worker applies its result only to the version it read.
// - Customers only ever see a report someone sent: the portal and the emailed link serve it while it is "sent".
//   Editing a sent report, or completing the job again, takes it back to draft until it is sent again.
// - Sending records whether the AI draft was sent as drafted ("accepted") or changed first ("edited").

// ------------------------------------------------------------------ text helpers

const PREFILL: Record<
  Locale,
  { completed: (title: string) => string; checks: string; readings: string; parts: string }
> = {
  en: {
    completed: (title) => `Completed: ${title}.`,
    checks: "Checks carried out",
    readings: "Readings",
    parts: "Parts used",
  },
  id: {
    completed: (title) => `Pekerjaan selesai: ${title}.`,
    checks: "Pemeriksaan yang dilakukan",
    readings: "Hasil pengukuran",
    parts: "Suku cadang yang dipakai",
  },
};

const intlLocale = (locale: Locale) => (locale === "id" ? "id-ID" : "en-US");

/** A checklist answer as the customer reads it: a checkbox is done or not, a reading keeps its unit. */
export function checklistLine(item: ChecklistItemRecord, locale: Locale): ReportChecklistLine {
  let value: string | null = null;
  if (item.kind === "number" && typeof item.value === "number") {
    const n = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(item.value);
    value = item.unit ? `${n} ${item.unit}` : n;
  } else if (item.kind === "text" && typeof item.value === "string" && item.value.trim()) {
    value = item.value.trim();
  }
  // A reading or text left blank doesn't count as done.
  const answered = item.kind === "checkbox" || item.kind === "photo" || value !== null;
  return { label: item.label, value, done: item.doneAt !== null && answered };
}

/** The draft FieldOps writes without AI: what was completed, the checks, the readings, the parts and the notes. */
export function prefillReport(input: Omit<ReportModelInput, "photos" | "organizationName">): ReportDraft {
  const t = PREFILL[input.locale] ?? PREFILL.en;
  const done = input.checklist.filter((c) => c.done);
  const checks = done.filter((c) => c.value === null).map((c) => c.label);
  // "Filter size: 16x25x1", without the answer's own full stop before the list's separator.
  const readings = done
    .filter((c) => c.value !== null)
    .map((c) => `${c.label}: ${c.value!.replace(/[.\s]+$/, "")}`);
  const parts = input.parts.map((p) => `${p.description} × ${p.quantity}`);
  const work = [
    t.completed(input.job.title),
    checks.length ? `${t.checks}: ${checks.join("; ")}.` : null,
    readings.length ? `${t.readings}: ${readings.join("; ")}.` : null,
    parts.length ? `${t.parts}: ${parts.join("; ")}.` : null,
  ].filter(Boolean);
  return {
    workPerformed: clip(work.join("\n")),
    findings: input.notes.length ? clip(input.notes.join("\n\n")) : null,
    recommendations: null,
    nextServiceDate: null,
  };
}

function clip(s: string): string {
  return s.trim().slice(0, MAX_REPORT_TEXT).trim();
}

const blankToNull = (s: string | null) => {
  const v = s === null ? "" : clip(s);
  return v === "" ? null : v;
};

/** Days between two YYYY-MM-DD dates. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Validates the model's output and clips it into a draft: texts cut to size, blanks become null, and the next
 * service date must be a real date after the completion date and within three years. Returns null when the
 * output doesn't match the schema or says nothing about the work.
 */
export function sanitizeReportDraft(raw: unknown, completedOn: string): ReportDraft | null {
  const parsed = reportModelOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const o = parsed.data;
  const work = clip(o.work_performed);
  if (!work) return null;
  let next: string | null = null;
  const d = o.next_service_date?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    const real = new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    const days = daysBetween(completedOn, d);
    if (real && days > 0 && days <= 3 * 366) next = d;
  }
  return {
    workPerformed: work,
    findings: blankToNull(o.findings),
    recommendations: blankToNull(o.recommendations),
    nextServiceDate: next,
  };
}

/** Whether the report's text differs from a draft. */
export function differsFromDraft(report: ServiceReportRecord, draft: ReportDraft): boolean {
  return (
    (report.workPerformed ?? "") !== draft.workPerformed ||
    (report.findings ?? null) !== draft.findings ||
    (report.recommendations ?? null) !== draft.recommendations ||
    (report.nextServiceDate ?? null) !== draft.nextServiceDate
  );
}

const draftPatch = (d: ReportDraft): ServiceReportPatch => ({
  workPerformed: d.workPerformed,
  findings: d.findings,
  recommendations: d.recommendations,
  nextServiceDate: d.nextServiceDate,
});

/** Photos for the report: ready images, before ones first, then after ones, then the rest. */
export function reportPhotos(attachments: AttachmentRecord[]): AttachmentRecord[] {
  const rank = (a: AttachmentRecord) => (a.tag === "before" ? 0 : a.tag === "after" ? 1 : 2);
  return attachments
    .filter((a) => a.kind === "photo" && a.status === "ready" && a.mimeType.startsWith("image/"))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((x) => x.a);
}

// ------------------------------------------------------------------ facts about a job

interface ReportFacts {
  org: OrganizationRecord;
  locale: Locale;
  input: Omit<ReportModelInput, "photos">;
  photos: AttachmentRecord[];
}

/** What a report says about a job, read from the store: the model's input and the prefill's. */
async function reportFacts(store: Store, job: JobView, now: Date): Promise<ReportFacts> {
  const [org, customer, items, notes, expenses, equipment, attachments] = await Promise.all([
    store.organization.get(),
    store.customers.get(job.customerId),
    store.checklist.list(job.id),
    store.notes.list(job.id, { visibility: "customer" }),
    store.expenses.listByJob(job.id),
    job.equipmentId ? store.equipment.get(job.equipmentId) : Promise.resolve(null),
    store.attachments.list(job.id),
  ]);
  const locale = customer?.locale ?? org.settings.locale;
  return {
    org,
    locale,
    input: {
      locale,
      organizationName: org.name,
      job: {
        number: formatJobNumber(job.number),
        title: job.title,
        description: job.description,
        serviceType: job.serviceType?.name ?? null,
        equipment: equipment
          ? [equipment.type, equipment.brand, equipment.model].filter(Boolean).join(" · ")
          : null,
        completedOn: localDateString(job.completedAt ?? now, org.timezone),
      },
      checklist: items.map((i) => checklistLine(i, locale)),
      notes: notes.filter((n) => n.visibility === "customer").map((n) => n.body),
      parts: expenses
        .filter((e) => e.kind === "part" && e.status === "approved" && e.usedAt !== null)
        .map((e) => ({ description: e.item, quantity: e.quantity })),
    },
    photos: reportPhotos(attachments),
  };
}

/** "pending" when the organization has AI on and quota left this month, "skipped" otherwise. */
async function initialAiStatus(store: Store, org: OrganizationRecord, now: Date) {
  if (!org.settings.ai.enabled) return "skipped" as const;
  const used = await store.ai.countSince(monthStart(now));
  return used < org.settings.ai.monthlyQuota ? ("pending" as const) : ("skipped" as const);
}

// ------------------------------------------------------------------ the completion hook

/**
 * Called once from the "complete" transition, in its transaction. Creates the job's report, or, when the job is
 * completed again after a reopen: a sent report goes back to draft with its text (to review and send again), an
 * untouched draft is drafted again from the new work, and a draft someone edited is kept as it is.
 */
export async function onJobCompleted(ctx: ServiceContext, job: JobView): Promise<ServiceReportRecord> {
  const existing = await ctx.store.reports.getByJob(job.id);
  if (existing?.status === "sent") {
    return (await ctx.store.reports.update(existing.id, { status: "draft" }))!;
  }
  if (existing?.editedBy) return existing;
  const facts = await reportFacts(ctx.store, job, ctx.now);
  const prefill = prefillReport(facts.input);
  const aiStatus = await initialAiStatus(ctx.store, facts.org, ctx.now);
  if (existing) {
    return (await ctx.store.reports.update(existing.id, {
      ...draftPatch(prefill),
      locale: facts.locale,
      aiStatus,
      aiDrafted: false,
      aiInteractionId: null,
    }))!;
  }
  const created = await ctx.store.reports.create({
    jobId: job.id,
    status: "draft",
    locale: facts.locale,
    ...prefill,
    aiStatus,
    aiInteractionId: null,
    aiDrafted: false,
    editedBy: null,
    sentAt: null,
    sentTo: null,
    sentBy: null,
  });
  // A concurrent completion created it first (one report per job).
  return created ?? (await ctx.store.reports.getByJob(job.id))!;
}

// ------------------------------------------------------------------ reading and editing

/** The job's report for its page, with who may change it and the customer's contact emails. */
export async function getReport(ctx: ServiceContext, jobId: string) {
  const job = await getJob(ctx, jobId);
  const [report, contacts] = await Promise.all([
    ctx.store.reports.getByJob(job.id),
    ctx.store.customers.contacts(job.customerId),
  ]);
  return {
    job,
    report,
    canWrite: can(ctx.actor, "reports.write", { assigned: isAssigned(ctx, job) }),
    contacts: contacts
      .filter((c) => c.email)
      .map((c) => ({ name: c.name, email: c.email!, isPrimary: c.isPrimary })),
  };
}

async function writableJob(ctx: ServiceContext, jobId: string) {
  const job = await getJob(ctx, jobId);
  assertCan(ctx.actor, "reports.write", { assigned: isAssigned(ctx, job) });
  return job;
}

/** The job's report, created now for a completed job that has none (jobs completed before reports existed). */
async function ensureReport(ctx: ServiceContext, job: JobView): Promise<ServiceReportRecord> {
  const existing = await ctx.store.reports.getByJob(job.id);
  if (existing) return existing;
  if (job.status !== "completed") throw new ConflictError("The job isn't completed yet");
  return onJobCompleted(ctx, job);
}

/** Starts the report of a completed job that has none. */
export async function startReport(ctx: ServiceContext, jobId: string) {
  const job = await writableJob(ctx, jobId);
  return ensureReport(ctx, job);
}

/**
 * Saves a person's changes (PATCH /jobs/{id}/report). Text changes record the editor; changing a sent report
 * takes it back to draft until it is sent again.
 */
export async function updateReport(
  ctx: ServiceContext,
  jobId: string,
  raw: unknown,
  expectedVersion?: number,
) {
  const input = parseInput(reportUpdateSchema, raw);
  const job = await writableJob(ctx, jobId);
  const report = await ensureReport(ctx, job);
  if (expectedVersion !== undefined && report.version !== expectedVersion)
    throw new PreconditionFailedError();
  const patch: ServiceReportPatch = {};
  if (input.work_performed !== undefined) patch.workPerformed = input.work_performed ?? null;
  if (input.findings !== undefined) patch.findings = input.findings ?? null;
  if (input.recommendations !== undefined) patch.recommendations = input.recommendations ?? null;
  if (input.next_service_date !== undefined) patch.nextServiceDate = input.next_service_date;
  if (input.locale !== undefined) patch.locale = input.locale;
  const changed = (Object.keys(patch) as (keyof ServiceReportPatch)[]).filter(
    (k) => (patch[k] ?? null) !== (report[k] ?? null),
  );
  if (changed.length === 0) return report;
  if (changed.some((k) => k !== "locale")) patch.editedBy = ctx.actor.userId;
  if (report.status === "sent") patch.status = "draft";
  const updated = await ctx.store.reports.update(report.id, patch, report.version);
  if (!updated) throw new PreconditionFailedError();
  return updated;
}

// ------------------------------------------------------------------ AI drafts

/** Reads up to MAX_REPORT_AI_PHOTOS photos one by one, keeping their before or after tag; unreadable ones are skipped. */
async function readPhotos(
  photos: AttachmentRecord[],
  load: (attachments: AttachmentRecord[]) => Promise<IntakePhoto[]>,
): Promise<ReportModelInput["photos"]> {
  const out: ReportModelInput["photos"] = [];
  for (const a of photos.slice(0, MAX_REPORT_AI_PHOTOS)) {
    const [photo] = await load([a]).catch(() => []);
    if (photo) out.push({ ...photo, tag: a.tag });
  }
  return out;
}

const usageColumns = (r: ReportModelResult) => ({
  model: r.model,
  inputTokens: r.usage.inputTokens,
  outputTokens: r.usage.outputTokens,
  cacheReadTokens: r.usage.cacheReadTokens,
  cacheWriteTokens: r.usage.cacheWriteTokens,
  latencyMs: Math.round(r.latencyMs),
  stopReason: r.stopReason,
});

/** Logs a report call and returns the sanitized draft, or null when there is none. */
async function logReportCall(
  store: Store,
  userId: string | null,
  jobId: string,
  result: ReportModelResult,
  completedOn: string,
) {
  const draft = result.kind === "draft" ? sanitizeReportDraft(result.output, completedOn) : null;
  const outcome: AiOutcome = draft ? "drafted" : result.kind === "refused" ? "refused" : "failed";
  const { id } = await store.ai.logInteraction({
    userId,
    jobId,
    feature: "report",
    ...usageColumns(result),
    outcome,
    output: draft,
    error: result.kind === "draft" ? (draft ? null : "The output didn't match the schema") : result.error,
  });
  return { draft, interactionId: id, outcome };
}

export interface ReportDraftResult {
  status: "drafted" | "refused" | "failed";
  report: ServiceReportRecord;
  model: string;
  quota: { used: number; limit: number };
  rateLimit: RateLimitStatus | null;
}

/**
 * "Draft with AI" / "Regenerate" on the job page and `POST /jobs/{id}/report-draft` (AI-03): drafts the report
 * now and replaces its text. Office roles and the job's technicians; counts against the monthly quota and the AI
 * rate limits like intake. Two short transactions with the model call between them. A refusal or an error keeps
 * the current text.
 */
export async function draftReport(
  run: TxRunner,
  model: ReportModel,
  jobId: string,
  guard: { ip: string | null; limits: AiLimits },
  loadPhotos: (attachments: AttachmentRecord[]) => Promise<IntakePhoto[]>,
): Promise<ReportDraftResult> {
  const prep = await run(async (ctx) => {
    const job = await writableJob(ctx, jobId);
    assertCan(ctx.actor, "ai.use", { assigned: isAssigned(ctx, job) });
    const org = await assertAiAvailable(ctx.store, model);
    const used = await assertUnderQuota(ctx.store, org.settings.ai.monthlyQuota, ctx.now);
    const rateLimit = await applyAiRateLimits(ctx, guard);
    const report = await ensureReport(ctx, job);
    await ctx.store.reports.setAiStatus(report.id, "drafting");
    const facts = await reportFacts(ctx.store, job, ctx.now);
    return { job, report, facts, rateLimit, quota: { used: used + 1, limit: org.settings.ai.monthlyQuota } };
  });
  const photos = await readPhotos(prep.facts.photos, loadPhotos);
  const result = await model.draft({ ...prep.facts.input, photos });
  return run(async (ctx) => {
    const { draft, interactionId, outcome } = await logReportCall(
      ctx.store,
      ctx.actor.userId,
      prep.job.id,
      result,
      prep.facts.input.job.completedOn,
    );
    const current = (await ctx.store.reports.get(prep.report.id))!;
    const report = draft
      ? await ctx.store.reports.update(current.id, {
          ...draftPatch(draft),
          locale: prep.facts.locale,
          status: "draft",
          aiStatus: "drafted",
          aiDrafted: true,
          aiInteractionId: interactionId,
          editedBy: null,
        })
      : null;
    if (!report) await ctx.store.reports.setAiStatus(current.id, "failed");
    return {
      status: outcome === "drafted" ? "drafted" : outcome === "refused" ? "refused" : "failed",
      report: report ?? (await ctx.store.reports.get(current.id))!,
      model: result.model,
      quota: prep.quota,
      rateLimit: prep.rateLimit,
    };
  });
}

/**
 * Drafts one report the worker claimed (ai_status "drafting"). Skips it when AI is off, not configured or over the
 * monthly quota (the prefilled text stays). The draft replaces the text only if nobody changed the report since it
 * was read; otherwise the person's text wins and the draft is logged as discarded. Returns the new status.
 */
export async function draftPendingReport(
  run: StoreRunner,
  model: ReportModel,
  jobId: string,
  loadPhotos: (attachments: AttachmentRecord[]) => Promise<IntakePhoto[]>,
  now: Date,
): Promise<"drafted" | "failed" | "skipped" | null> {
  const prep = await run(async (store) => {
    const [report, job] = await Promise.all([store.reports.getByJob(jobId), store.jobs.get(jobId)]);
    if (!report || !job || report.aiStatus !== "drafting") return null;
    const org = await store.organization.get();
    const used = await store.ai.countSince(monthStart(now));
    if (
      !org.settings.ai.enabled ||
      model.provider === "unavailable" ||
      used >= org.settings.ai.monthlyQuota ||
      report.editedBy !== null
    ) {
      await store.reports.setAiStatus(report.id, "skipped");
      return "skipped" as const;
    }
    return { report, facts: await reportFacts(store, job, now) };
  });
  if (prep === null || prep === "skipped") return prep;
  const photos = await readPhotos(prep.facts.photos, loadPhotos);
  const result = await model.draft({ ...prep.facts.input, photos });
  return run(async (store) => {
    const { draft, interactionId } = await logReportCall(
      store,
      null,
      jobId,
      result,
      prep.facts.input.job.completedOn,
    );
    if (!draft) {
      await store.reports.setAiStatus(prep.report.id, "failed", "drafting");
      return "failed";
    }
    const applied = await store.reports.update(
      prep.report.id,
      {
        ...draftPatch(draft),
        aiStatus: "drafted",
        aiDrafted: true,
        aiInteractionId: interactionId,
      },
      prep.report.version,
    );
    if (applied) return "drafted";
    // Someone changed the report meanwhile: their text wins.
    await store.ai.setOutcome(interactionId, "discarded");
    await store.reports.setAiStatus(prep.report.id, "skipped", "drafting");
    return "skipped";
  });
}

// ------------------------------------------------------------------ sending

/**
 * Sends the report to one of the customer's contacts (AI-03, §8.7): marks it sent, records the `report_sent` job
 * event and the AI draft's outcome, and writes the "Job completed" email with a signed link valid for
 * REPORT_LINK_DAYS days. Sending again (to another contact, or after changes) is allowed.
 */
export async function sendReport(ctx: ServiceContext, jobId: string, raw: unknown, deps: ReportSendDeps) {
  const input = parseInput(reportSendSchema, raw);
  const job = await writableJob(ctx, jobId);
  const report = await ctx.store.reports.getByJob(job.id);
  if (!report) throw new NotFoundError("Service report");
  if (!report.workPerformed?.trim()) {
    throw new ValidationError("Describe the work performed before sending", [
      { path: "work_performed", message: "Required" },
    ]);
  }
  const contacts = await ctx.store.customers.contacts(job.customerId);
  const contact = contacts.find((c) => c.email?.toLowerCase() === input.to);
  if (!contact) {
    throw new ValidationError("Send the report to one of the customer's contacts", [
      { path: "to", message: "Not a contact of this customer" },
    ]);
  }
  const sent = await ctx.store.reports.update(
    report.id,
    { status: "sent", sentAt: ctx.now, sentTo: input.to, sentBy: ctx.actor.userId },
    report.version,
  );
  if (!sent) throw new PreconditionFailedError();
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "report_sent",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: { report_id: report.id, to: input.to },
  });
  if (report.aiInteractionId) {
    const interaction = await ctx.store.ai.getInteraction(report.aiInteractionId);
    if (interaction?.outcome === "drafted") {
      const draft = interaction.output as ReportDraft | null;
      const outcome: AiOutcome = draft && !differsFromDraft(report, draft) ? "accepted" : "edited";
      await ctx.store.ai.setOutcome(interaction.id, outcome);
    }
  }
  const org = await ctx.store.organization.get();
  const expiresAt = new Date(ctx.now.getTime() + REPORT_LINK_DAYS * 86_400_000);
  await deps.sendEmail({
    to: input.to,
    locale: report.locale,
    contactName: contact.name,
    organizationName: org.name,
    jobNumber: formatJobNumber(job.number),
    jobTitle: job.title,
    completedOn: localDateString(job.completedAt ?? ctx.now, org.timezone),
    url: deps.linkFor({ organizationId: ctx.store.organizationId, reportId: report.id }, expiresAt),
    expiresAt,
  });
  return { report: sent, expiresAt };
}

// ------------------------------------------------------------------ the PDF

/** Reads what the report's PDF shows. No permission checks: callers check access first. */
export async function loadReportDocument(store: Store, jobId: string): Promise<ReportDocumentData | null> {
  const [report, job] = await Promise.all([store.reports.getByJob(jobId), store.jobs.get(jobId)]);
  if (!report || !job) return null;
  const [customer, site, contacts, attachments, facts] = await Promise.all([
    store.customers.get(job.customerId),
    store.sites.get(job.siteId),
    store.customers.contacts(job.customerId),
    store.attachments.list(job.id),
    reportFacts(store, job, job.completedAt ?? new Date()),
  ]);
  const signature =
    attachments
      .filter((a) => a.kind === "signature" && a.status === "ready")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const lead = job.assignees.filter((a) => a.isLead);
  return {
    report,
    organization: facts.org,
    job,
    customer: customer!,
    site: site!,
    primaryContact: contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null,
    completedOn: facts.input.job.completedOn,
    technicians: [...lead, ...job.assignees.filter((a) => !a.isLead)].map((a) => a.name),
    checklist: facts.input.checklist,
    parts: facts.input.parts,
    photos: facts.photos,
    signature,
  };
}

/** The PDF data for the office or the job's technicians: any status (preview). */
export async function reportDocument(ctx: ServiceContext, jobId: string): Promise<ReportDocumentData> {
  const job = await getJob(ctx, jobId);
  const data = await loadReportDocument(ctx.store, job.id);
  if (!data) throw new NotFoundError("Service report");
  return data;
}

/** A report a customer may download: sent, on a job of their own. */
export async function portalReport(ctx: PortalContext, number: number) {
  const row = await ctx.store.portal.getJobByNumber(ctx.portal.customerId, number);
  if (!row) throw new NotFoundError("Job");
  const report = await ctx.store.reports.getByJob(row.id);
  return report?.status === "sent" ? { jobId: row.id, report } : null;
}

export async function portalReportDocument(ctx: PortalContext, number: number) {
  const found = await portalReport(ctx, number);
  if (!found) throw new NotFoundError("Service report");
  return (await loadReportDocument(ctx.store, found.jobId))!;
}

/**
 * The PDF behind an emailed link (no sign-in; the link's signature was checked by the caller). Null when the
 * report is gone; `updating` when it was changed after sending and hasn't been sent again.
 */
export async function linkedReportDocument(
  store: Store,
  reportId: string,
): Promise<ReportDocumentData | "updating" | null> {
  const report = await store.reports.get(reportId);
  if (!report) return null;
  if (report.status !== "sent") return "updating";
  return loadReportDocument(store, report.jobId);
}
