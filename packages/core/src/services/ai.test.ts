import type { IntakeModelOutput } from "@fieldops/shared";
import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnavailableError,
  ValidationError,
} from "../domain/errors";
import { world } from "../test/fixtures";
import { ctxFor, actorFor, uuid } from "../test/memory-store";
import type {
  AiLimits,
  IntakeCatalog,
  IntakeModel,
  IntakeModelInput,
  IntakeModelResult,
  StoreRunner,
  TxRunner,
} from "./ai-types";
import * as ai from "./ai";
import * as jobs from "./jobs";
import type { ServiceContext, Store } from "./types";

type World = ReturnType<typeof world>;

const NO_LIMITS: AiLimits = { perUserPerHour: 0, perVisitorPerDay: null, globalPerDay: 0 };
const guard = (limits: Partial<AiLimits> = {}, ip: string | null = null) => ({
  ip,
  limits: { ...NO_LIMITS, ...limits },
});

function output(w: World, extra: Partial<IntakeModelOutput> = {}): IntakeModelOutput {
  return {
    language: "en",
    title: "AC leaking in the bedroom",
    service_type_id: w.serviceTypeId,
    priority: "high",
    priority_reason: "Water is dripping near electronics.",
    summary: "The bedroom unit leaks water since this morning.",
    checklist: ["Check the drain line", "Check the drain line", "Inspect the pump"],
    estimated_duration_min: 93,
    equipment: { type: "Split AC", brand: "Carrier", model: " " },
    contact: { name: "Cara", phone: "(512) 555-0142", email: null, address: "1 Main St" },
    questions: ["Is the unit still running?"],
    confidence: {
      title: 0.9,
      service_type: 0.95,
      priority: 1.4,
      summary: 0.8,
      estimated_duration: -1,
      equipment: 0.5,
      contact: 0.7,
    },
    ...extra,
  };
}

/** A model that returns a fixed result and remembers what it was asked. */
function fakeModel(
  result: (input: IntakeModelInput) => IntakeModelResult,
  provider: IntakeModel["provider"] = "fixture",
) {
  const calls: IntakeModelInput[] = [];
  const model: IntakeModel = {
    provider,
    model: "fixture-intake",
    async draft(input) {
      calls.push(input);
      return result(input);
    },
  };
  return { model, calls };
}

const usage = { inputTokens: 1800, outputTokens: 420, cacheReadTokens: 1200, cacheWriteTokens: 0 };
const drafted = (o: unknown): IntakeModelResult => ({
  kind: "draft",
  output: o,
  model: "fixture-intake",
  usage,
  stopReason: "end_turn",
  latencyMs: 2400.4,
});

/** Runs each transaction against the same memory store as `member`. */
const runner =
  (w: World, m = w.dispatcher, extra: Partial<ServiceContext> = {}): TxRunner =>
  (fn) =>
    fn(w.ctx(m, extra));
const storeRunner =
  (w: World): StoreRunner =>
  (fn) =>
    fn(w.store);

function catalog(w: World): IntakeCatalog {
  return {
    organizationName: "Acme",
    country: "US",
    currency: "USD",
    serviceTypes: [
      {
        id: w.serviceTypeId,
        name: "AC repair",
        description: null,
        defaultDurationMin: 120,
        requiredSkills: [],
      },
    ],
    skills: [],
  };
}

describe("intakeCatalog", () => {
  it("lists active service types and every skill, sorted", async () => {
    const w = world();
    w.data.serviceTypes.push({ ...w.data.serviceTypes[0]!, id: uuid(), name: "Old", active: false });
    w.data.serviceTypes[0]!.requiredSkills = ["refrigerant"];
    w.data.members[3]!.skills = ["ac", "electrical"];
    const c = await ai.intakeCatalog(w.store);
    expect(c.serviceTypes.map((s) => s.name)).toEqual(["AC repair"]);
    expect(c.skills).toEqual(["ac", "electrical", "refrigerant"]);
    expect(c).toMatchObject({ organizationName: "Acme", country: "US", currency: "USD" });
  });
});

describe("sanitizeIntakeDraft", () => {
  it("clamps confidences, dedupes lists, rounds the duration and blanks empty strings", () => {
    const w = world();
    const d = ai.sanitizeIntakeDraft(output(w), catalog(w))!;
    expect(d.checklist).toEqual(["Check the drain line", "Inspect the pump"]);
    expect(d.estimated_duration_min).toBe(95);
    expect(d.equipment).toEqual({ type: "Split AC", brand: "Carrier", model: null });
    expect(d.confidence.priority).toBe(1);
    expect(d.confidence.estimated_duration).toBe(0);
    expect(d.service_type_id).toBe(w.serviceTypeId);
  });

  it("drops service types the organization doesn't have and falls back to sane defaults", () => {
    const w = world();
    const d = ai.sanitizeIntakeDraft(
      output(w, {
        service_type_id: "made-up",
        title: "   ",
        estimated_duration_min: null,
        checklist: Array.from({ length: 9 }, (_, i) => `Check ${i}`),
        questions: ["", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
        confidence: { ...output(w).confidence, service_type: 0.9, title: 0.8 },
      }),
      catalog(w),
    )!;
    expect(d.service_type_id).toBeNull();
    expect(d.confidence.service_type).toBe(0);
    expect(d.title).toBe("Service request");
    expect(d.confidence.title).toBe(0);
    expect(d.estimated_duration_min).toBeNull();
    expect(d.checklist).toHaveLength(ai.MAX_CHECKLIST_SUGGESTIONS);
    expect(d.questions).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5"]);
  });

  it("uses the service type's duration when the model gives none, and caps long durations", () => {
    const w = world();
    expect(
      ai.sanitizeIntakeDraft(output(w, { estimated_duration_min: null }), catalog(w))!.estimated_duration_min,
    ).toBe(120);
    expect(
      ai.sanitizeIntakeDraft(output(w, { estimated_duration_min: 99999 }), catalog(w))!
        .estimated_duration_min,
    ).toBe(1440);
    expect(
      ai.sanitizeIntakeDraft(output(w, { estimated_duration_min: 1 }), catalog(w))!.estimated_duration_min,
    ).toBe(5);
  });

  it("rejects output that doesn't match the schema", () => {
    const w = world();
    expect(ai.sanitizeIntakeDraft({ title: "x" }, catalog(w))).toBeNull();
    expect(ai.sanitizeIntakeDraft(output(w, { priority: "asap" as never }), catalog(w))).toBeNull();
  });
});

describe("suggestCustomers", () => {
  it("matches by phone or email first, then by name", async () => {
    const w = world();
    const d = (contact: Partial<IntakeModelOutput["contact"]>) => ({
      name: null,
      phone: null,
      email: null,
      address: null,
      ...contact,
    });
    expect(await ai.suggestCustomers(w.store, d({ phone: "512-555-0142" }), "US")).toEqual([
      { id: w.customerId, name: "Cara Customer", matched_on: "phone" },
    ]);
    expect(await ai.suggestCustomers(w.store, d({ email: "CARA@example.com" }), "US")).toEqual([
      { id: w.customerId, name: "Cara Customer", matched_on: "email" },
    ]);
    expect(await ai.suggestCustomers(w.store, d({ name: "Other" }), "US")).toEqual([
      { id: w.otherCustomerId, name: "Other Corp", matched_on: "name" },
    ]);
    expect(await ai.suggestCustomers(w.store, d({ name: "Ca" }), "US")).toEqual([]);
    expect(await ai.suggestCustomers(w.store, d({}), "US")).toEqual([]);
  });

  it("falls back to a name search", async () => {
    const w = world();
    const store: Store = {
      ...w.store,
      customers: {
        ...w.store.customers,
        async list() {
          return {
            rows: [
              { id: w.customerId, name: "Cara Customer" },
              { id: w.customerId, name: "Cara Customer" },
            ] as never,
            nextCursor: null,
            total: null,
          };
        },
      },
    };
    expect(
      await ai.suggestCustomers(store, { name: "Cara", phone: null, email: null, address: null }, "US"),
    ).toEqual([{ id: w.customerId, name: "Cara Customer", matched_on: "name" }]);
  });
});

describe("draftIntake", () => {
  const raw = { message: "Hi, my AC in the bedroom is leaking water. Cara, (512) 555-0142" };

  it("drafts, logs the call and suggests the customer", async () => {
    const w = world();
    const { model, calls } = fakeModel(() => drafted(output(w)));
    const photos = [{ media_type: "image/jpeg", data: "aGVsbG8=" }];
    const r = await ai.draftIntake(runner(w), model, { ...raw, photos }, guard({ perUserPerHour: 20 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.title).toBe("AC leaking in the bedroom");
    expect(r.customerSuggestions).toEqual([{ id: w.customerId, name: "Cara Customer", matched_on: "phone" }]);
    expect(r.quota).toEqual({ used: 1, limit: 500 });
    expect(r.rateLimit).toMatchObject({ limit: 20, remaining: 19 });
    expect(calls[0]!.photos).toEqual([{ mediaType: "image/jpeg", data: "aGVsbG8=" }]);
    expect(calls[0]!.catalog.serviceTypes).toHaveLength(1);
    const logged = w.data.automate!.aiInteractions[0]!;
    expect(logged).toMatchObject({
      userId: w.dispatcher.userId,
      feature: "intake",
      outcome: "drafted",
      inputTokens: 1800,
      cacheReadTokens: 1200,
      latencyMs: 2400,
      stopReason: "end_turn",
      error: null,
    });
  });

  it("logs refusals, failures and schema mismatches and returns ok: false", async () => {
    const w = world();
    const base = { model: "fixture-intake", usage, latencyMs: 10 };
    const refused = fakeModel(() => ({ ...base, kind: "refused", stopReason: "refusal", error: null }));
    const failed = fakeModel(() => ({ ...base, kind: "failed", stopReason: null, error: "timeout" }));
    const garbage = fakeModel(() => drafted({ nope: true }));
    expect(await ai.draftIntake(runner(w), refused.model, raw, guard())).toMatchObject({
      ok: false,
      reason: "refused",
    });
    expect(await ai.draftIntake(runner(w), failed.model, raw, guard())).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(await ai.draftIntake(runner(w), garbage.model, raw, guard())).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(w.data.automate!.aiInteractions.map((i) => [i.outcome, i.error])).toEqual([
      ["refused", null],
      ["failed", "timeout"],
      ["failed", "The output didn't match the schema"],
    ]);
  });

  it("is for office roles and validates the message", async () => {
    const w = world();
    const { model, calls } = fakeModel(() => drafted(output(w)));
    await expect(ai.draftIntake(runner(w, w.tom), model, raw, guard())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(ai.draftIntake(runner(w), model, { message: "short" }, guard())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(calls).toHaveLength(0);
  });

  it("is unavailable when AI is off for the organization or not configured", async () => {
    const w = world();
    const off = fakeModel(() => drafted(output(w)), "unavailable");
    await expect(ai.draftIntake(runner(w), off.model, raw, guard())).rejects.toMatchObject({
      code: "unavailable",
      details: { reason: "not_configured" },
    });
    w.data.org.settings.ai.enabled = false;
    const on = fakeModel(() => drafted(output(w)));
    await expect(ai.draftIntake(runner(w), on.model, raw, guard())).rejects.toBeInstanceOf(UnavailableError);
  });

  it("stops at the monthly quota", async () => {
    const w = world();
    w.data.org.settings.ai.monthlyQuota = 1;
    const { model } = fakeModel(() => drafted(output(w)));
    await ai.draftIntake(runner(w), model, raw, guard());
    const err = await ai.draftIntake(runner(w), model, raw, guard()).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.details).toMatchObject({
      scope: "monthly_quota",
      limit: 1,
      resetAt: "2026-12-01T00:00:00.000Z",
    });
  });

  it("enforces the per-user, per-visitor and global limits", async () => {
    const w = world();
    const { model } = fakeModel(() => drafted(output(w)));
    await ai.draftIntake(runner(w), model, raw, guard({ perUserPerHour: 1 }));
    await expect(ai.draftIntake(runner(w), model, raw, guard({ perUserPerHour: 1 }))).rejects.toMatchObject({
      code: "rate_limited",
      details: { scope: "user" },
    });
    // The visitor limit needs an IP address; the owner shares the visitor's address.
    await ai.draftIntake(runner(w, w.owner), model, raw, guard({ perVisitorPerDay: 1 }, "203.0.113.9"));
    await expect(
      ai.draftIntake(runner(w, w.admin), model, raw, guard({ perVisitorPerDay: 1 }, "203.0.113.9")),
    ).rejects.toMatchObject({ details: { scope: "visitor" } });
    await ai.draftIntake(runner(w, w.admin), model, raw, guard({ perVisitorPerDay: 1 }));
    await ai.draftIntake(runner(w, w.admin), model, raw, guard({ globalPerDay: 1 }));
    await expect(ai.draftIntake(runner(w, w.admin), model, raw, guard({ globalPerDay: 1 }))).rejects.toThrow(
      /budget for today/,
    );
  });

  it("reports the tightest limit", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    expect(await ai.applyAiRateLimits(ctx, guard())).toBeNull();
    const s = await ai.applyAiRateLimits(ctx, guard({ perUserPerHour: 10, globalPerDay: 3 }));
    expect(s).toEqual({ limit: 3, remaining: 2, resetAt: new Date("2026-11-11T00:00:00Z") });
  });
});

describe("recordOutcome and createJobFromDraft", () => {
  async function draft(w: World, o = output(w)) {
    const { model } = fakeModel(() => drafted(o));
    const r = await ai.draftIntake(runner(w), model, { message: "AC leaking water, please help" }, guard());
    if (!r.ok) throw new Error("expected a draft");
    return r;
  }
  const jobFrom = (w: World, d: ai.IntakeSuccess, extra: Record<string, unknown> = {}) => ({
    customer_id: w.customerId,
    site_id: w.siteId,
    title: d.draft.title,
    service_type_id: d.draft.service_type_id,
    priority: d.draft.priority,
    estimated_duration_min: d.draft.estimated_duration_min,
    description: d.draft.summary,
    ...extra,
  });

  it("records a discarded draft once", async () => {
    const w = world();
    const d = await draft(w);
    expect(await ai.recordOutcome(w.ctx(w.dispatcher), d.interactionId, { outcome: "discarded" })).toEqual({
      id: d.interactionId,
      outcome: "discarded",
    });
    await expect(
      ai.recordOutcome(w.ctx(w.dispatcher), d.interactionId, { outcome: "accepted" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      ai.recordOutcome(w.ctx(w.dispatcher), uuid(), { outcome: "accepted" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("saves the job as an AI draft without another review, with the kept checklist items", async () => {
    const w = world();
    w.data.serviceTypes[0]!.checklistTemplate = [
      { label: "Photo of the unit", kind: "photo", required: true },
    ];
    const d = await draft(w);
    const r = await ai.createJobFromDraft(w.ctx(w.dispatcher), {
      interaction_id: d.interactionId,
      checklist: ["Check the drain line", "photo of the unit"],
      job: jobFrom(w, d),
    });
    expect(r.outcome).toBe("accepted");
    expect(r.job).toMatchObject({ source: "ai_intake", aiDrafted: true, needsReview: false });
    expect(w.data.checklist.filter((i) => i.jobId === r.job.id).map((i) => [i.label, i.required])).toEqual([
      ["Photo of the unit", true],
      ["Check the drain line", false],
    ]);
    const logged = w.data.automate!.aiInteractions[0]!;
    expect([logged.outcome, logged.jobId]).toEqual(["accepted", r.job.id]);
    await expect(
      ai.createJobFromDraft(w.ctx(w.dispatcher), { interaction_id: d.interactionId, job: jobFrom(w, d) }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("marks the draft edited when the dispatcher changed it", async () => {
    const w = world();
    const d = await draft(w);
    const r = await ai.createJobFromDraft(w.ctx(w.dispatcher), {
      interaction_id: d.interactionId,
      job: jobFrom(w, d, { priority: "urgent" }),
    });
    expect(r.outcome).toBe("edited");
    await expect(
      ai.createJobFromDraft(w.ctx(w.dispatcher), { interaction_id: uuid(), job: jobFrom(w, d) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is edited when the stored draft can't be read", async () => {
    const w = world();
    const d = await draft(w);
    w.data.automate!.aiInteractions[0]!.output = { broken: true };
    const r = await ai.createJobFromDraft(w.ctx(w.dispatcher), {
      interaction_id: d.interactionId,
      job: jobFrom(w, d),
    });
    expect(r.outcome).toBe("edited");
  });
});

describe("portal requests", () => {
  async function portalJob(w: World, aiStatus: "drafting" | "pending" = "drafting") {
    const j = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Service request",
      description: "Water drips from the indoor unit.",
      source: "portal",
    });
    w.data.jobs.find((x) => x.id === j.id)!.aiStatus = aiStatus;
    return j;
  }
  const photo = (w: World, jobId: string, extra: Record<string, unknown> = {}) =>
    w.data.attachments.push({
      id: uuid(),
      jobId,
      kind: "photo",
      storageKey: "k",
      thumbKey: null,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      tag: null,
      caption: null,
      status: "ready",
      takenAt: null,
      uploadedBy: null,
      createdAt: new Date(),
      ...extra,
    } as never);

  it("drafts a claimed request with its photos and logs it against the job", async () => {
    const w = world();
    const j = await portalJob(w);
    photo(w, j.id);
    photo(w, j.id, { mimeType: "application/pdf", kind: "document" });
    const { model, calls } = fakeModel(() => drafted(output(w)));
    const loaded: string[][] = [];
    const status = await ai.draftPortalJob(
      storeRunner(w),
      model,
      j.id,
      async (atts) => {
        loaded.push(atts.map((a) => a.mimeType));
        return [{ mediaType: "image/jpeg", data: "aGk=" }];
      },
      new Date("2026-11-10T09:00:00Z"),
    );
    expect(status).toBe("drafted");
    expect(loaded).toEqual([["image/jpeg"]]);
    expect(calls[0]!.message).toBe("Service request\n\nWater drips from the indoor unit.");
    expect(w.data.jobs.find((x) => x.id === j.id)!.aiStatus).toBe("drafted");
    expect(w.data.automate!.aiInteractions[0]).toMatchObject({
      jobId: j.id,
      userId: null,
      outcome: "drafted",
    });
  });

  it("marks failures, survives photo errors and skips when AI is off", async () => {
    const w = world();
    const now = new Date("2026-11-10T09:00:00Z");
    const failing = fakeModel(() => ({
      kind: "failed",
      model: "m",
      usage,
      stopReason: null,
      latencyMs: 5,
      error: "overloaded",
    }));
    const a = await portalJob(w);
    const broken = async () => {
      throw new Error("disk");
    };
    expect(await ai.draftPortalJob(storeRunner(w), failing.model, a.id, broken, now)).toBe("failed");
    expect(failing.calls[0]!.photos).toEqual([]);
    const refused = fakeModel(() => ({
      kind: "refused",
      model: "m",
      usage,
      stopReason: "refusal",
      latencyMs: 5,
      error: null,
    }));
    const b = await portalJob(w);
    expect(await ai.draftPortalJob(storeRunner(w), refused.model, b.id, async () => [], now)).toBe("failed");
    const garbage = fakeModel(() => drafted({}));
    const g = await portalJob(w);
    expect(await ai.draftPortalJob(storeRunner(w), garbage.model, g.id, async () => [], now)).toBe("failed");

    const c = await portalJob(w);
    const unavailable = fakeModel(() => drafted(output(w)), "unavailable");
    expect(await ai.draftPortalJob(storeRunner(w), unavailable.model, c.id, async () => [], now)).toBe(
      "skipped",
    );
    expect(w.data.jobs.find((x) => x.id === c.id)!.aiStatus).toBe("skipped");
    expect(unavailable.calls).toHaveLength(0);
  });

  it("ignores jobs that weren't claimed or disappeared while drafting", async () => {
    const w = world();
    const now = new Date("2026-11-10T09:00:00Z");
    const { model } = fakeModel(() => drafted(output(w)));
    const pending = await portalJob(w, "pending");
    expect(await ai.draftPortalJob(storeRunner(w), model, pending.id, async () => [], now)).toBeNull();
    expect(await ai.draftPortalJob(storeRunner(w), model, uuid(), async () => [], now)).toBeNull();
    const gone = await portalJob(w);
    const vanishing = fakeModel(() => {
      w.data.jobs.find((x) => x.id === gone.id)!.deleted = true;
      return drafted(output(w));
    });
    expect(await ai.draftPortalJob(storeRunner(w), vanishing.model, gone.id, async () => [], now)).toBeNull();
  });

  it("lists what a draft would change", () => {
    const w = world();
    const d = ai.sanitizeIntakeDraft(output(w), catalog(w))!;
    const job = {
      title: d.title,
      serviceTypeId: null,
      priority: "normal" as const,
      estimatedDurationMin: 95,
    };
    expect(ai.reviewChanges(d, job)).toEqual(["service_type_id", "priority", "checklist"]);
    expect(ai.reviewChanges(d, job, ["check the drain line", "Inspect the pump"])).toEqual([
      "service_type_id",
      "priority",
    ]);
    expect(
      ai.reviewChanges(
        { ...d, service_type_id: null, estimated_duration_min: null, checklist: [] },
        { ...job, title: "Other" },
      ),
    ).toEqual(["title", "priority"]);
  });

  it("applies chosen fields through the job update, then confirms", async () => {
    const w = world();
    const now = new Date("2026-11-10T09:00:00Z");
    const j = await portalJob(w);
    const { model } = fakeModel(() => drafted(output(w)));
    await ai.draftPortalJob(storeRunner(w), model, j.id, async () => [], now);

    const review = await ai.getReview(w.ctx(w.dispatcher), j.id);
    expect(review.draft?.priority).toBe("high");
    expect(review.outcome).toBe("drafted");
    await expect(ai.getReview(w.ctx(w.tom), j.id)).rejects.toBeInstanceOf(ForbiddenError);

    const kept = await ai.reviewJob(w.ctx(w.dispatcher), j.id, {
      apply: ["priority", "checklist"],
      confirm: false,
    });
    expect(kept.applied).toEqual(["priority", "checklist"]);
    expect(kept.job).toMatchObject({ priority: "high", needsReview: true });
    expect(w.data.checklist.filter((i) => i.jobId === j.id).map((i) => i.label)).toEqual([
      "Check the drain line",
      "Inspect the pump",
    ]);
    expect(w.data.automate!.aiInteractions[0]!.outcome).toBe("edited");

    const done = await ai.reviewJob(w.ctx(w.dispatcher), j.id, { apply: ["title"] });
    expect(done.job).toMatchObject({
      title: "AC leaking in the bedroom",
      needsReview: false,
      aiDrafted: true,
    });
    expect(
      w.data.events.filter((e) => e.jobId === j.id && e.type === "reviewed").map((e) => e.payload),
    ).toEqual([
      { applied: ["priority", "checklist"], confirmed: false },
      { applied: ["title"], confirmed: true },
    ]);
    await expect(ai.reviewJob(w.ctx(w.dispatcher), j.id, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("confirms without the draft (discarded) and refuses to apply a missing draft", async () => {
    const w = world();
    const now = new Date("2026-11-10T09:00:00Z");
    const plain = await portalJob(w, "pending");
    await expect(ai.reviewJob(w.ctx(w.dispatcher), plain.id, { apply: ["title"] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const r = await ai.reviewJob(w.ctx(w.dispatcher), plain.id, {});
    expect(r.job).toMatchObject({ needsReview: false, aiDrafted: false });

    const j = await portalJob(w);
    const { model } = fakeModel(() => drafted(output(w)));
    await ai.draftPortalJob(storeRunner(w), model, j.id, async () => [], now);
    await ai.reviewJob(w.ctx(w.dispatcher), j.id, { apply: [] });
    expect(w.data.automate!.aiInteractions[0]!.outcome).toBe("discarded");
  });

  it("accepts a draft applied in full, and won't touch a started checklist", async () => {
    const w = world();
    const now = new Date("2026-11-10T09:00:00Z");
    const j = await portalJob(w);
    const { model } = fakeModel(() => drafted(output(w)));
    await ai.draftPortalJob(storeRunner(w), model, j.id, async () => [], now);
    const offered = ai.reviewChanges((await ai.getReview(w.ctx(w.owner), j.id)).draft!, j);
    await ai.reviewJob(w.ctx(w.owner), j.id, {
      apply: offered.filter((f) => f !== "checklist"),
      confirm: false,
    });
    expect(w.data.automate!.aiInteractions[0]!.outcome).toBe("edited");

    const k = await portalJob(w);
    await ai.draftPortalJob(storeRunner(w), model, k.id, async () => [], now);
    await ai.reviewJob(w.ctx(w.owner), k.id, { apply: ["checklist"], confirm: false });
    w.data.checklist.find((i) => i.jobId === k.id)!.doneAt = new Date();
    w.data.automate!.aiInteractions.at(-1)!.output = {
      ...(w.data.automate!.aiInteractions.at(-1)!.output as object),
      checklist: ["A brand new check"],
    };
    await expect(ai.reviewJob(w.ctx(w.owner), k.id, { apply: ["checklist"] })).rejects.toBeInstanceOf(
      ConflictError,
    );

    const all = await portalJob(w);
    await ai.draftPortalJob(storeRunner(w), model, all.id, async () => [], now);
    const job = (await ai.getReview(w.ctx(w.owner), all.id)).job;
    await ai.reviewJob(w.ctx(w.owner), all.id, {
      apply: ai.reviewChanges((await ai.getReview(w.ctx(w.owner), all.id)).draft!, job),
    });
    expect(w.data.automate!.aiInteractions.at(-1)!.outcome).toBe("accepted");
  });
});

describe("intakeStatus", () => {
  it("says whether the form can offer a draft, and why not", async () => {
    const w = world();
    expect(await ai.intakeStatus(w.ctx(w.dispatcher), "anthropic")).toEqual({
      available: true,
      reason: null,
      used: 0,
      limit: 500,
    });
    expect(await ai.intakeStatus(w.ctx(w.tom), "anthropic")).toMatchObject({
      available: false,
      reason: null,
    });
    expect((await ai.intakeStatus(w.ctx(w.owner), "unavailable")).reason).toBe("not_configured");
    w.data.org.settings.ai.monthlyQuota = 0;
    expect((await ai.intakeStatus(w.ctx(w.owner), "fixture")).reason).toBe("quota");
    w.data.org.settings.ai.enabled = false;
    expect((await ai.intakeStatus(w.ctx(w.owner), "fixture")).reason).toBe("disabled");
  });
});

describe("AI settings", () => {
  it("reads usage and the acceptance rate, and updates the settings", async () => {
    const w = world();
    const s = await ai.getAiSettings(w.ctx(w.owner), "fixture");
    expect(s).toMatchObject({ enabled: true, monthlyQuota: 500, provider: "fixture", acceptanceRate: null });
    const base = {
      userId: null,
      jobId: null,
      feature: "intake" as const,
      model: "m",
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      latencyMs: 1000,
      stopReason: "end_turn",
      output: null,
      error: null,
    };
    for (const outcome of ["accepted", "edited", "discarded", "failed"] as const)
      await w.store.ai.logInteraction({ ...base, outcome });
    const after = await ai.getAiSettings(w.ctx(w.admin), "anthropic");
    expect(after.usage).toMatchObject({
      calls: 4,
      inputTokens: 400,
      outputTokens: 40,
      cacheReadTokens: 200,
      avgLatencyMs: 1000,
    });
    expect(after.acceptanceRate).toBeCloseTo(2 / 3);
    expect(await ai.updateAiSettings(w.ctx(w.owner), { enabled: false, monthly_quota: 50 })).toEqual({
      enabled: false,
      monthlyQuota: 50,
    });
    expect(w.data.org.settings.requireSignature).toBe(false);
    await expect(ai.getAiSettings(w.ctx(w.dispatcher), "fixture")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      ai.updateAiSettings(w.ctx(w.owner), { enabled: true, monthly_quota: -1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("starts months in UTC", () => {
    expect(ai.monthStart(new Date("2026-11-30T23:59:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(ctxFor(world().store, actorFor(world().owner)).now.toISOString()).toBe("2026-11-10T09:00:00.000Z");
  });
});
