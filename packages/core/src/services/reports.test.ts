import type { ReportModelOutput } from "@fieldops/shared";
import { describe, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  RateLimitedError,
  UnavailableError,
  ValidationError,
} from "../domain/errors";
import { iso, world } from "../test/fixtures";
import { memoryReportRows } from "../test/memory-reports";
import { uuid } from "../test/memory-store";
import type { AiLimits, StoreRunner, TxRunner } from "./ai-types";
import type { MemoryChecklistItem } from "../test/memory-fieldwork";
import * as jobs from "./jobs";
import type { PortalContext } from "./portal-types";
import type { ReportEmail, ReportModel, ReportModelInput, ReportModelResult } from "./report-types";
import * as reports from "./reports";
import type { ServiceContext } from "./types";

type World = ReturnType<typeof world>;

const NO_LIMITS: AiLimits = { perUserPerHour: 0, perVisitorPerDay: null, globalPerDay: 0 };
const guard = (limits: Partial<AiLimits> = {}) => ({ ip: null, limits: { ...NO_LIMITS, ...limits } });
const usage = { inputTokens: 1500, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 0 };
const NOW = new Date("2026-11-10T09:00:00Z");

function output(extra: Partial<ReportModelOutput> = {}): ReportModelOutput {
  return {
    work_performed: "Flushed the drain line and cleaned the coil.",
    findings: "The drain line was clogged.",
    recommendations: "  ",
    next_service_date: "2027-05-10",
    ...extra,
  };
}

const drafted = (o: unknown): ReportModelResult => ({
  kind: "draft",
  output: o,
  model: "fixture-report",
  usage,
  stopReason: "end_turn",
  latencyMs: 812.6,
});

function fakeModel(
  result: (input: ReportModelInput) => ReportModelResult,
  provider: ReportModel["provider"] = "fixture",
) {
  const calls: ReportModelInput[] = [];
  const model: ReportModel = {
    provider,
    model: "fixture-report",
    async draft(input) {
      calls.push(input);
      return result(input);
    },
  };
  return { model, calls };
}

const runner =
  (w: World, m = w.dispatcher, extra: Partial<ServiceContext> = {}): TxRunner =>
  (fn) =>
    fn(w.ctx(m, extra));
const storeRunner =
  (w: World): StoreRunner =>
  (fn) =>
    fn(w.store);

const interactions = (w: World) => w.data.automate!.aiInteractions;
const rows = (w: World) => memoryReportRows(w.data);

function item(w: World, jobId: string, extra: Partial<MemoryChecklistItem>) {
  w.data.checklist.push({
    id: uuid(),
    jobId,
    position: w.data.checklist.length,
    label: "Check",
    kind: "checkbox",
    unit: null,
    required: false,
    value: null,
    doneAt: null,
    ...extra,
    done: Boolean(extra.doneAt),
  });
}

/** A job assigned to Tom, in progress, with checklist answers, notes and a used part. */
async function workedJob(w: World, title = "Bedroom AC leaking water") {
  const j = await jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    equipment_id: w.equipmentId,
    service_type_id: w.serviceTypeId,
    title,
    description: "Water drips from the indoor unit.",
  });
  await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
    member_ids: [w.tom.id],
    scheduled_start: iso(9),
    scheduled_end: iso(11),
    override_reason: "Tests reuse the slot",
  });
  await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
  const done = new Date("2026-11-10T08:30:00Z");
  item(w, j.id, { label: "Check the drain line", value: true, doneAt: done });
  item(w, j.id, { label: "Supply air", kind: "number", unit: "°C", value: 13.5, doneAt: done });
  item(w, j.id, { label: "Filter size", kind: "text", value: " 16x25x1 ", doneAt: done });
  item(w, j.id, { label: "Photo after", kind: "photo", value: null, doneAt: null });
  item(w, j.id, { label: "Note", kind: "text", value: "  ", doneAt: done });
  await jobs.addNote(w.ctx(w.tom), j.id, {
    body: "Customer: clean the filter monthly.",
    visibility: "customer",
  });
  await jobs.addNote(w.ctx(w.tom), j.id, {
    body: "Internal: charge the call-out fee.",
    visibility: "internal",
  });
  return j;
}

async function completed(w: World, title?: string) {
  const j = await workedJob(w, title);
  await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" });
  return j;
}

const report = (w: World, jobId: string) => rows(w).find((r) => r.jobId === jobId)!;

function addPhoto(w: World, jobId: string, extra: Record<string, unknown> = {}) {
  const id = uuid();
  w.data.attachments.push({
    id,
    jobId,
    kind: "photo",
    storageKey: `org/x/jobs/${jobId}/${id}/p.jpg`,
    thumbKey: `org/x/jobs/${jobId}/${id}/thumb.webp`,
    fileName: "p.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 9000,
    tag: null,
    caption: null,
    status: "ready",
    uploadedBy: w.tom.userId,
    createdAt: new Date(),
    ...extra,
  });
  return id;
}

describe("text helpers", () => {
  it("formats checklist answers for the customer", () => {
    const base = {
      id: "i",
      jobId: "j",
      position: 0,
      label: "Supply air",
      required: false,
      doneBy: null,
    };
    const done = new Date();
    expect(
      reports.checklistLine({ ...base, kind: "number", unit: "°C", value: 13.5, doneAt: done }, "id"),
    ).toEqual({ label: "Supply air", value: "13,5 °C", done: true });
    expect(
      reports.checklistLine({ ...base, kind: "number", unit: null, value: 4, doneAt: done }, "en").value,
    ).toBe("4");
    expect(
      reports.checklistLine({ ...base, kind: "checkbox", unit: null, value: true, doneAt: null }, "en"),
    ).toEqual({
      label: "Supply air",
      value: null,
      done: false,
    });
  });

  it("sanitizes the model's output: clips, blanks to null, and keeps only plausible next dates", () => {
    expect(reports.sanitizeReportDraft(output(), "2026-11-10")).toEqual({
      workPerformed: "Flushed the drain line and cleaned the coil.",
      findings: "The drain line was clogged.",
      recommendations: null,
      nextServiceDate: "2027-05-10",
    });
    const long = reports.sanitizeReportDraft(
      output({ work_performed: "x".repeat(9000), findings: null }),
      "2026-11-10",
    );
    expect(long!.workPerformed).toHaveLength(5000);
    expect(long!.findings).toBeNull();
    for (const bad of ["2026-11-10", "2026-02-30", "2031-01-01", "next spring", null]) {
      expect(
        reports.sanitizeReportDraft(output({ next_service_date: bad }), "2026-11-10")!.nextServiceDate,
      ).toBeNull();
    }
    expect(reports.sanitizeReportDraft(output({ work_performed: "  " }), "2026-11-10")).toBeNull();
    expect(reports.sanitizeReportDraft({ nope: true }, "2026-11-10")).toBeNull();
  });

  it("orders photos before, after, then the rest, and skips what isn't a ready image", () => {
    const w = world();
    const a = addPhoto(w, "j", { tag: "after" });
    const b = addPhoto(w, "j", { tag: "before" });
    const c = addPhoto(w, "j");
    addPhoto(w, "j", { status: "pending" });
    addPhoto(w, "j", { kind: "document", mimeType: "application/pdf" });
    expect(reports.reportPhotos(w.data.attachments).map((x) => x.id)).toEqual([b, a, c]);
  });
});

describe("completing a job", () => {
  it("creates a prefilled draft in the customer's language, pending AI", async () => {
    const w = world();
    const j = await completed(w);
    const r = report(w, j.id);
    expect(r).toMatchObject({
      status: "draft",
      locale: "en",
      aiStatus: "pending",
      aiDrafted: false,
      editedBy: null,
    });
    expect(r.workPerformed).toBe(
      [
        "Completed: Bedroom AC leaking water.",
        "Checks carried out: Check the drain line.",
        "Readings: Supply air: 13.5 °C; Filter size: 16x25x1.",
      ].join("\n"),
    );
    // Only notes for the customer; internal notes never reach the report.
    expect(r.findings).toBe("Customer: clean the filter monthly.");
    expect(r.recommendations).toBeNull();
  });

  it("writes Indonesian for an Indonesian customer and skips AI when it is off or used up", async () => {
    const w = world();
    w.data.customers.find((c) => c.id === w.customerId)!.locale = "id";
    w.data.org.settings.ai.enabled = false;
    const j = await completed(w);
    expect(report(w, j.id)).toMatchObject({ locale: "id", aiStatus: "skipped" });
    expect(report(w, j.id).workPerformed).toContain("Pekerjaan selesai: Bedroom AC leaking water.");
    expect(report(w, j.id).workPerformed).toContain("Pemeriksaan yang dilakukan: Check the drain line.");

    const w2 = world();
    w2.data.org.settings.locale = "id";
    w2.data.org.settings.ai.monthlyQuota = 0;
    const j2 = await completed(w2);
    expect(report(w2, j2.id)).toMatchObject({ locale: "id", aiStatus: "skipped" });
  });

  it("lists used parts in the prefill", async () => {
    const w = world();
    const j = await workedJob(w);
    await w.store.expenses.create({
      jobId: j.id,
      requesterMemberId: w.tom.id,
      kind: "part",
      item: "Drain pump",
      quantity: 1,
      unitCostMinor: 4500,
      totalMinor: 4500,
      currency: "USD",
      supplier: null,
      reason: "Pump failed",
      receiptAttachmentId: null,
      status: "approved",
      autoApproved: true,
      decidedByMemberId: null,
      decidedAt: null,
      decisionComment: null,
    });
    const [part] = await w.store.expenses.listByJob(j.id);
    await w.store.expenses.markUsed(part!.id, NOW);
    await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" });
    expect(report(w, j.id).workPerformed).toContain("Parts used: Drain pump × 1.");
  });

  it("on completing again: a sent report goes back to draft, an untouched draft is redone, an edited one is kept", async () => {
    const w = world();
    const j = await completed(w);
    const reopen = () =>
      jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "in_progress", reason: "Still leaking" });
    const complete = () => jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" });

    // Untouched: drafted again from the new work.
    await reopen();
    item(w, j.id, { label: "Replaced the pump", value: true, doneAt: NOW });
    await complete();
    expect(rows(w)).toHaveLength(1);
    expect(report(w, j.id).workPerformed).toContain("Replaced the pump");

    // Edited: kept as the person wrote it.
    await reports.updateReport(w.ctx(w.tom), j.id, { work_performed: "My own words." });
    await reopen();
    await complete();
    expect(report(w, j.id).workPerformed).toBe("My own words.");

    // Sent: back to draft with its text.
    await reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "cara@example.com" }, deps().deps);
    await reopen();
    expect(report(w, j.id).status).toBe("sent");
    await complete();
    expect(report(w, j.id)).toMatchObject({
      status: "draft",
      workPerformed: "My own words.",
      sentTo: "cara@example.com",
    });
  });

  it("returns the report created by a concurrent completion", async () => {
    const w = world();
    const j = await workedJob(w);
    const view = (await w.store.jobs.get(j.id))!;
    const first = await reports.onJobCompleted(w.ctx(w.tom), view);
    const store = w.store.reports;
    const original = store.getByJob.bind(store);
    let calls = 0;
    store.getByJob = async (id) => (calls++ === 0 ? null : original(id));
    const again = await reports.onJobCompleted(w.ctx(w.tom), view);
    store.getByJob = original;
    expect(again.id).toBe(first.id);
  });
});

describe("reading and editing", () => {
  it("shows the report with the customer's contact emails and who may write", async () => {
    const w = world();
    const j = await completed(w);
    const forTom = await reports.getReport(w.ctx(w.tom), j.id);
    expect(forTom).toMatchObject({
      canWrite: true,
      contacts: [{ email: "cara@example.com", isPrimary: true }],
    });
    expect(forTom.report!.jobId).toBe(j.id);
    await expect(reports.getReport(w.ctx(w.rina), j.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records the editor, ignores no-op changes and takes a sent report back to draft", async () => {
    const w = world();
    const j = await completed(w);
    const before = report(w, j.id);
    expect(
      await reports.updateReport(w.ctx(w.dispatcher), j.id, { work_performed: before.workPerformed }),
    ).toEqual(before);
    const lang = await reports.updateReport(w.ctx(w.dispatcher), j.id, { locale: "id" });
    expect(lang).toMatchObject({ locale: "id", editedBy: null });
    const edited = await reports.updateReport(
      w.ctx(w.dispatcher),
      j.id,
      {
        work_performed: "Cleaned the coil.",
        findings: "",
        recommendations: "Replace the filter",
        next_service_date: "2027-05-01",
      },
      lang.version,
    );
    expect(edited).toMatchObject({
      workPerformed: "Cleaned the coil.",
      findings: null,
      recommendations: "Replace the filter",
      nextServiceDate: "2027-05-01",
      editedBy: w.dispatcher.userId,
    });
    await expect(
      reports.updateReport(w.ctx(w.dispatcher), j.id, { findings: "x" }, 1),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    await reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "cara@example.com" }, deps().deps);
    expect((await reports.updateReport(w.ctx(w.dispatcher), j.id, { findings: "More" })).status).toBe(
      "draft",
    );
  });

  it("fails when the store changed underneath", async () => {
    const w = world();
    const j = await completed(w);
    const original = w.store.reports.update.bind(w.store.reports);
    w.store.reports.update = async () => null;
    await expect(reports.updateReport(w.ctx(w.dispatcher), j.id, { findings: "x" })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await expect(
      reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "cara@example.com" }, deps().deps),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    w.store.reports.update = original;
  });

  it("lets only the office and the job's technicians write", async () => {
    const w = world();
    const j = await completed(w);
    await expect(reports.updateReport(w.ctx(w.rina), j.id, { findings: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    w.data.assignments.push({ jobId: j.id, memberId: w.rina.id, isLead: false });
    expect((await reports.updateReport(w.ctx(w.rina), j.id, { findings: "x" })).findings).toBe("x");
  });

  it("starts a report for a completed job that has none, and refuses one for open jobs", async () => {
    const w = world();
    const j = await completed(w);
    rows(w).length = 0;
    const started = await reports.startReport(w.ctx(w.dispatcher), j.id);
    expect(started.jobId).toBe(j.id);
    expect((await reports.startReport(w.ctx(w.dispatcher), j.id)).id).toBe(started.id);
    const open = await workedJob(w, "Open job");
    await expect(reports.startReport(w.ctx(w.dispatcher), open.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      reports.updateReport(w.ctx(w.dispatcher), open.id, { findings: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

function deps() {
  const emails: ReportEmail[] = [];
  return {
    emails,
    deps: {
      async sendEmail(e: ReportEmail) {
        emails.push(e);
      },
      linkFor: (r: { organizationId: string; reportId: string }, expiresAt: Date) =>
        `https://app.example/share/reports/${r.reportId}?exp=${expiresAt.getTime()}`,
    },
  };
}

describe("sending", () => {
  it("emails a signed link to a contact, marks it sent and records the event", async () => {
    const w = world();
    const j = await completed(w);
    const d = deps();
    const { report: sent, expiresAt } = await reports.sendReport(
      w.ctx(w.tom),
      j.id,
      { to: " Cara@Example.com " },
      d.deps,
    );
    expect(sent).toMatchObject({ status: "sent", sentTo: "cara@example.com", sentBy: w.tom.userId });
    expect(expiresAt.toISOString()).toBe("2026-12-10T09:00:00.000Z");
    expect(d.emails[0]).toMatchObject({
      to: "cara@example.com",
      locale: "en",
      contactName: "Cara",
      organizationName: "Acme",
      jobNumber: "JOB-000001",
      jobTitle: "Bedroom AC leaking water",
      url: `https://app.example/share/reports/${sent.id}?exp=${expiresAt.getTime()}`,
    });
    const events = await w.store.jobs.events(j.id);
    expect(events[0]).toMatchObject({
      type: "report_sent",
      payload: { report_id: sent.id, to: "cara@example.com" },
    });
  });

  it("only sends to the customer's contacts, and only with the work described", async () => {
    const w = world();
    const j = await completed(w);
    await expect(
      reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "someone@else.com" }, deps().deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "nope" }, deps().deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await reports.updateReport(w.ctx(w.dispatcher), j.id, { work_performed: "" });
    await expect(
      reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "cara@example.com" }, deps().deps),
    ).rejects.toBeInstanceOf(ValidationError);
    const open = await workedJob(w, "Open");
    await expect(
      reports.sendReport(w.ctx(w.dispatcher), open.id, { to: "cara@example.com" }, deps().deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    const tech = await completed(w, "Other");
    await expect(
      reports.sendReport(w.ctx(w.rina), tech.id, { to: "cara@example.com" }, deps().deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records whether the AI draft was sent as drafted or edited", async () => {
    const w = world();
    const j = await completed(w);
    const m = fakeModel(() => drafted(output()));
    await reports.draftReport(runner(w), m.model, j.id, guard(), async () => []);
    await reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "cara@example.com" }, deps().deps);
    expect(interactions(w).at(-1)!.outcome).toBe("accepted");
    // Sending again doesn't decide it twice.
    await reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "cara@example.com" }, deps().deps);
    expect(interactions(w).at(-1)!.outcome).toBe("accepted");

    const k = await completed(w, "Second");
    await reports.draftReport(runner(w), m.model, k.id, guard(), async () => []);
    await reports.updateReport(w.ctx(w.dispatcher), k.id, { findings: "Edited." });
    await reports.sendReport(w.ctx(w.dispatcher), k.id, { to: "cara@example.com" }, deps().deps);
    expect(interactions(w).at(-1)!.outcome).toBe("edited");
  });
});

describe("Draft with AI", () => {
  it("drafts the report now with up to 4 photos and logs the call against the quota", async () => {
    const w = world();
    const j = await completed(w);
    for (const tag of ["after", "before", null, null, null] as const) addPhoto(w, j.id, { tag });
    const m = fakeModel(() => drafted(output()));
    const loaded: string[] = [];
    const result = await reports.draftReport(runner(w, w.tom), m.model, j.id, guard(), async ([a]) => {
      loaded.push(a!.id);
      if (loaded.length === 3) throw new Error("unreadable");
      return loaded.length === 4 ? [] : [{ mediaType: "image/webp", data: "aGk=" }];
    });
    expect(result).toMatchObject({
      status: "drafted",
      model: "fixture-report",
      quota: { used: 1, limit: 500 },
    });
    expect(result.report).toMatchObject({
      workPerformed: "Flushed the drain line and cleaned the coil.",
      nextServiceDate: "2027-05-10",
      aiStatus: "drafted",
      aiDrafted: true,
      editedBy: null,
    });
    expect(loaded).toHaveLength(4);
    expect(m.calls[0]!.photos.map((p) => p.tag)).toEqual(["before", "after"]);
    expect(m.calls[0]).toMatchObject({
      locale: "en",
      organizationName: "Acme",
      notes: ["Customer: clean the filter monthly."],
      job: {
        number: "JOB-000001",
        serviceType: "AC repair",
        equipment: "Split AC · Carrier",
        completedOn: "2026-11-10",
      },
    });
    expect(interactions(w).at(-1)).toMatchObject({
      feature: "report",
      jobId: j.id,
      userId: w.tom.userId,
      outcome: "drafted",
    });
  });

  it("keeps the text on refusals and errors, and marks the AI status failed", async () => {
    const w = world();
    const j = await completed(w);
    const before = report(w, j.id).workPerformed;
    const refused = fakeModel(() => ({
      kind: "refused",
      model: "m",
      usage,
      stopReason: "refusal",
      latencyMs: 3,
      error: "cyber",
    }));
    expect((await reports.draftReport(runner(w), refused.model, j.id, guard(), async () => [])).status).toBe(
      "refused",
    );
    const failed = fakeModel(() => ({
      kind: "failed",
      model: "m",
      usage,
      stopReason: null,
      latencyMs: 3,
      error: "boom",
    }));
    expect((await reports.draftReport(runner(w), failed.model, j.id, guard(), async () => [])).status).toBe(
      "failed",
    );
    const garbage = fakeModel(() => drafted({ work_performed: 3 }));
    const r = await reports.draftReport(runner(w), garbage.model, j.id, guard(), async () => []);
    expect(r).toMatchObject({ status: "failed", report: { aiStatus: "failed", workPerformed: before } });
    expect(interactions(w).map((i) => i.outcome)).toEqual(["refused", "failed", "failed"]);
  });

  it("checks permissions, AI settings, the quota and the rate limits", async () => {
    const w = world();
    const j = await completed(w);
    const m = fakeModel(() => drafted(output()));
    await expect(
      reports.draftReport(runner(w, w.rina), m.model, j.id, guard(), async () => []),
    ).rejects.toBeInstanceOf(NotFoundError);
    const off = fakeModel(() => drafted(output()), "unavailable");
    await expect(
      reports.draftReport(runner(w), off.model, j.id, guard(), async () => []),
    ).rejects.toBeInstanceOf(UnavailableError);
    await expect(
      reports.draftReport(runner(w), m.model, j.id, guard({ perUserPerHour: 1 }), async () => []),
    ).resolves.toMatchObject({ status: "drafted" });
    await expect(
      reports.draftReport(runner(w), m.model, j.id, guard({ perUserPerHour: 1 }), async () => []),
    ).rejects.toBeInstanceOf(RateLimitedError);
    w.data.org.settings.ai.monthlyQuota = 1;
    await expect(
      reports.draftReport(runner(w), m.model, j.id, guard(), async () => []),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(m.calls).toHaveLength(1);
    const open = await workedJob(w, "Open");
    w.data.org.settings.ai.monthlyQuota = 500;
    await expect(
      reports.draftReport(runner(w), m.model, open.id, guard(), async () => []),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("worker drafts", () => {
  const claim = (w: World, jobId: string) => {
    report(w, jobId).aiStatus = "drafting";
  };

  it("drafts a claimed report and applies it to the version it read", async () => {
    const w = world();
    const j = await completed(w);
    claim(w, j.id);
    const m = fakeModel(() => drafted(output()));
    expect(await reports.draftPendingReport(storeRunner(w), m.model, j.id, async () => [], NOW)).toBe(
      "drafted",
    );
    expect(report(w, j.id)).toMatchObject({
      aiStatus: "drafted",
      aiDrafted: true,
      findings: "The drain line was clogged.",
    });
    expect(interactions(w).at(-1)).toMatchObject({ feature: "report", userId: null, outcome: "drafted" });
    // Not claimed (any more): nothing to do.
    expect(await reports.draftPendingReport(storeRunner(w), m.model, j.id, async () => [], NOW)).toBeNull();
    expect(await reports.draftPendingReport(storeRunner(w), m.model, uuid(), async () => [], NOW)).toBeNull();
  });

  it("keeps a person's edits made while the model was writing", async () => {
    const w = world();
    const j = await completed(w);
    claim(w, j.id);
    const m = fakeModel(() => {
      const r = report(w, j.id);
      r.version += 1;
      r.workPerformed = "Typed meanwhile.";
      return drafted(output());
    });
    expect(await reports.draftPendingReport(storeRunner(w), m.model, j.id, async () => [], NOW)).toBe(
      "skipped",
    );
    expect(report(w, j.id)).toMatchObject({
      workPerformed: "Typed meanwhile.",
      aiStatus: "skipped",
      aiDrafted: false,
    });
    expect(interactions(w).at(-1)!.outcome).toBe("discarded");
  });

  it("marks failures and skips when AI is off, unavailable, used up or the report was edited", async () => {
    const w = world();
    const j = await completed(w);
    claim(w, j.id);
    const failing = fakeModel(() => ({
      kind: "failed",
      model: "m",
      usage,
      stopReason: null,
      latencyMs: 1,
      error: "x",
    }));
    expect(await reports.draftPendingReport(storeRunner(w), failing.model, j.id, async () => [], NOW)).toBe(
      "failed",
    );
    expect(report(w, j.id).aiStatus).toBe("failed");

    const ok = fakeModel(() => drafted(output()));
    claim(w, j.id);
    expect(
      await reports.draftPendingReport(
        storeRunner(w),
        fakeModel(() => drafted(output()), "unavailable").model,
        j.id,
        async () => [],
        NOW,
      ),
    ).toBe("skipped");
    claim(w, j.id);
    w.data.org.settings.ai.enabled = false;
    expect(await reports.draftPendingReport(storeRunner(w), ok.model, j.id, async () => [], NOW)).toBe(
      "skipped",
    );
    w.data.org.settings.ai.enabled = true;
    claim(w, j.id);
    w.data.org.settings.ai.monthlyQuota = 0;
    expect(await reports.draftPendingReport(storeRunner(w), ok.model, j.id, async () => [], NOW)).toBe(
      "skipped",
    );
    w.data.org.settings.ai.monthlyQuota = 500;
    claim(w, j.id);
    report(w, j.id).editedBy = w.tom.userId;
    expect(await reports.draftPendingReport(storeRunner(w), ok.model, j.id, async () => [], NOW)).toBe(
      "skipped",
    );
    expect(ok.calls).toHaveLength(0);
  });
});

describe("the PDF and customers", () => {
  it("loads what the PDF shows, technicians lead first", async () => {
    const w = world();
    const j = await completed(w);
    w.data.assignments.push({ jobId: j.id, memberId: w.rina.id, isLead: false });
    w.data.assignments.reverse();
    const photo = addPhoto(w, j.id, { tag: "before" });
    const sigOld = addPhoto(w, j.id, { kind: "signature", mimeType: "image/png", createdAt: new Date(1000) });
    const sigNew = addPhoto(w, j.id, { kind: "signature", mimeType: "image/png", createdAt: new Date(2000) });
    const data = await reports.reportDocument(w.ctx(w.tom), j.id);
    expect(data).toMatchObject({
      completedOn: "2026-11-10",
      technicians: ["Tom Tech", "Rina Tech"],
      customer: { name: "Cara Customer" },
      site: { label: "Home" },
      primaryContact: { name: "Cara" },
    });
    expect(data.photos.map((p) => p.id)).toEqual([photo]);
    expect(data.signature!.id).toBe(sigNew);
    expect(sigOld).not.toBe(sigNew);
    expect(data.checklist).toHaveLength(5);
    await reports.updateReport(w.ctx(w.tom), j.id, { locale: "id" });
    const id = await reports.reportDocument(w.ctx(w.tom), j.id);
    expect(id.checklist.find((c) => c.label === "Supply air")!.value).toBe("13,5 °C");
    const open = await workedJob(w, "Open");
    await expect(reports.reportDocument(w.ctx(w.tom), open.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await reports.loadReportDocument(w.store, uuid())).toBeNull();
  });

  it("gives customers sent reports of their own jobs only", async () => {
    const w = world();
    const j = await completed(w);
    const contact = w.data.contacts[0]!;
    const portal = (customerId: string): PortalContext => ({
      portal: {
        organizationId: w.store.organizationId,
        customerId,
        customerName: "x",
        contactId: contact.id,
        contactName: contact.name,
      },
      store: w.store,
      now: NOW,
      demo: false,
    });
    expect(await reports.portalReport(portal(w.customerId), 1)).toBeNull();
    await expect(reports.portalReportDocument(portal(w.customerId), 1)).rejects.toBeInstanceOf(NotFoundError);
    const id = report(w, j.id).id;
    expect(await reports.linkedReportDocument(w.store, id)).toBe("updating");
    await reports.sendReport(w.ctx(w.dispatcher), j.id, { to: "cara@example.com" }, deps().deps);
    expect((await reports.portalReport(portal(w.customerId), 1))!.jobId).toBe(j.id);
    expect((await reports.portalReportDocument(portal(w.customerId), 1)).report.id).toBe(id);
    await expect(reports.portalReport(portal(w.otherCustomerId), 1)).rejects.toBeInstanceOf(NotFoundError);
    const linked = await reports.linkedReportDocument(w.store, id);
    expect(linked && linked !== "updating" ? linked.job.id : null).toBe(j.id);
    expect(await reports.linkedReportDocument(w.store, uuid())).toBeNull();
  });
});
