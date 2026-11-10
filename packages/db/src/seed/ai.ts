import type { AiOutcome, IntakeDraft, JobPriority } from "@fieldops/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { demoRequestDraft, requestServiceType } from "./portal";
import { DAY, insertBatches } from "./time";

// AI intake history (AI-01, §9.7 usage log): about a month of drafts by the dispatchers, most saved as drafted
// or with edits, a few discarded or failed; and an AI draft for every recent portal request, so the review panel
// and the AI settings page have something to show. Model and token numbers follow the PRD's cost estimate.

const MODEL = "claude-opus-5-5";
const HISTORY_DAYS = 30;

/** Why the model chose a priority: for a fault the customer is waiting on, and for planned work. */
const PRIORITY_REASON = {
  en: {
    fault: {
      urgent: "No cooling with vulnerable people or equipment at risk.",
      high: "The unit is failing and the customer is affected now.",
      normal: "A fault that can wait for the next open slot.",
      low: "A minor fault the customer can live with for now.",
    },
    planned: {
      urgent: "The customer needs it done today.",
      high: "The customer asked for the earliest visit.",
      normal: "Planned work that can take the next open slot.",
      low: "Routine work with no deadline.",
    },
  },
  id: {
    fault: {
      urgent: "Tidak ada pendinginan dan ada risiko bagi penghuni atau peralatan.",
      high: "Unit bermasalah dan pelanggan terdampak sekarang.",
      normal: "Gangguan yang bisa menunggu jadwal berikutnya.",
      low: "Gangguan ringan yang masih bisa ditunda.",
    },
    planned: {
      urgent: "Pelanggan membutuhkannya hari ini.",
      high: "Pelanggan minta kunjungan secepatnya.",
      normal: "Pekerjaan terencana yang bisa mengikuti jadwal berikutnya.",
      low: "Pekerjaan rutin tanpa tenggat.",
    },
  },
} satisfies Record<"en" | "id", Record<"fault" | "planned", Record<JobPriority, string>>>;

const PRIORITIES: JobPriority[] = ["low", "normal", "high", "urgent"];

export async function seedAi(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 6);
  const lang = ctx.spec.fakerLocale === "en_US" ? "en" : "id";
  const office = ctx.members.filter((m) => m.role === "dispatcher" || m.role === "owner");
  const customers = new Map(ctx.customers.map((c) => [c.id, c.name]));
  const confidence = (high: boolean) =>
    Number(f.number.float({ min: high ? 0.75 : 0.4, max: high ? 0.98 : 0.7 }).toFixed(2));
  const usage = (cached: boolean) => ({
    inputTokens: f.number.int({ min: 1700, max: 2600 }),
    outputTokens: f.number.int({ min: 320, max: 680 }),
    cacheReadTokens: cached ? f.number.int({ min: 1250, max: 1500 }) : 0,
    cacheWriteTokens: cached ? 0 : f.number.int({ min: 1250, max: 1500 }),
    latencyMs: f.number.int({ min: 1900, max: 5400 }),
  });

  /**
   * A plausible draft for a job. "edited": the dispatcher changed something before saving, so the draft differs
   * a little. "review": a portal request still waiting for a dispatcher, with suggestions worth applying: the
   * service type and estimate it has none of yet, extra checks and, for a fault, a higher priority. Checks and
   * questions come from the job's service type, so a cleaning job never gets an AC check.
   */
  const draftFor = (
    j: {
      title: string;
      serviceTypeId: string | null;
      priority: string;
      estimatedDurationMin: number | null;
      description: string | null;
      customerId: string;
    },
    mode: "same" | "edited" | "review",
  ): IntakeDraft => {
    const type =
      mode === "review"
        ? requestServiceType(ctx, j.title)
        : (ctx.serviceTypes.find((st) => st.id === j.serviceTypeId) ?? null);
    const fault = type?.spec.fault ?? false;
    const demo = mode === "review" ? demoRequestDraft(ctx, j.title) : null;
    const priority = j.priority as JobPriority;
    const raised = fault ? PRIORITIES[Math.min(3, PRIORITIES.indexOf(priority) + 1)]! : priority;
    const confident = f.datatype.boolean({ probability: 0.8 });
    const suggested =
      mode === "review" ? raised : mode === "edited" && f.datatype.boolean() ? raised : priority;
    return {
      language: lang,
      title:
        demo?.title ??
        (mode === "edited" && f.datatype.boolean()
          ? `${j.title} ${lang === "en" ? "(repeat visit)" : "(kunjungan ulang)"}`
          : j.title),
      service_type_id: type?.id ?? j.serviceTypeId,
      priority: suggested,
      priority_reason: PRIORITY_REASON[lang][fault ? "fault" : "planned"][suggested],
      summary: demo?.summary ?? j.description ?? j.title,
      checklist: f.helpers.arrayElements(type?.spec.checks ?? [], { min: mode === "review" ? 1 : 0, max: 2 }),
      estimated_duration_min: mode === "review" ? (type?.defaultDurationMin ?? null) : j.estimatedDurationMin,
      equipment: { type: null, brand: null, model: null },
      contact: { name: customers.get(j.customerId) ?? null, phone: null, email: null, address: null },
      questions: f.helpers.arrayElements(type?.spec.questions ?? [], {
        min: mode === "review" ? 1 : 0,
        max: 2,
      }),
      confidence: {
        title: confidence(confident),
        service_type: confidence(confident),
        priority: confidence(f.datatype.boolean({ probability: 0.7 })),
        summary: confidence(true),
        estimated_duration: confidence(false),
        equipment: confidence(false),
        contact: confidence(confident),
      },
    };
  };

  const rows: (typeof s.aiInteraction.$inferInsert)[] = [];
  const aiJobs: string[] = [];
  const from = ctx.now.getTime() - HISTORY_DAYS * DAY;

  // Dispatcher drafts: about a quarter of the manually created jobs of the last month started as an AI draft.
  const manual = ctx.jobs.filter(
    (j) => j.source === "manual" && (j.createdAt as Date).getTime() >= from && j.createdBy,
  );
  let lastDay = -1;
  for (const j of manual) {
    if (!f.datatype.boolean({ probability: 0.25 })) continue;
    const created = j.createdAt as Date;
    const day = Math.floor(created.getTime() / DAY);
    const roll = f.number.float({ min: 0, max: 1 });
    const outcome: AiOutcome = roll < 0.62 ? "accepted" : roll < 0.92 ? "edited" : "discarded";
    const at = new Date(created.getTime() - f.number.int({ min: 40, max: 240 }) * 1000);
    const draft = draftFor(
      {
        title: j.title,
        serviceTypeId: j.serviceTypeId ?? null,
        priority: j.priority ?? "normal",
        estimatedDurationMin: j.estimatedDurationMin ?? null,
        description: j.description ?? null,
        customerId: j.customerId,
      },
      outcome === "edited" ? "edited" : "same",
    );
    rows.push({
      id: uuidv7(),
      organizationId: ctx.orgId,
      userId: j.createdBy ?? f.helpers.arrayElement(office).userId,
      jobId: outcome === "discarded" ? null : j.id,
      feature: "intake",
      model: MODEL,
      ...usage(day === lastDay),
      stopReason: "end_turn",
      outcome,
      output: draft,
      createdAt: at,
      updatedAt: created,
    });
    if (outcome !== "discarded") aiJobs.push(j.id);
    lastDay = day;
  }
  // A few calls that failed (overloaded) and fell back to the manual form.
  for (let i = 0; i < Math.max(1, Math.round(rows.length / 25)); i++) {
    const at = new Date(
      from +
        f.number.int({ min: 0, max: HISTORY_DAYS - 1 }) * DAY +
        f.number.int({ min: 9, max: 17 }) * 3_600_000,
    );
    rows.push({
      id: uuidv7(),
      organizationId: ctx.orgId,
      userId: f.helpers.arrayElement(office).userId,
      jobId: null,
      feature: "intake",
      model: MODEL,
      ...usage(false),
      outputTokens: 0,
      stopReason: null,
      outcome: "failed",
      output: null,
      error: "overloaded_error: Overloaded",
      createdAt: at,
      updatedAt: at,
    });
  }

  // Jobs that started as an AI draft say so (source and flag), like jobs saved from the form today.
  for (let i = 0; i < aiJobs.length; i += 500) {
    const ids = aiJobs.slice(i, i + 500);
    await ctx.tx
      .update(s.job)
      .set({ source: "ai_intake", aiDrafted: true })
      .where(and(eq(s.job.organizationId, ctx.orgId), inArray(s.job.id, ids)));
    await ctx.tx
      .update(s.jobEvent)
      .set({ payload: sql`jsonb_set(${s.jobEvent.payload}, '{source}', '"ai_intake"')` })
      .where(
        and(
          eq(s.jobEvent.organizationId, ctx.orgId),
          eq(s.jobEvent.type, "created"),
          inArray(s.jobEvent.jobId, ids),
        ),
      );
  }

  // Portal requests from the last month: the worker drafted each one a few seconds after it arrived. The ones
  // still waiting for review keep their draft open; the others were applied or discarded by a dispatcher.
  const portal = await ctx.tx
    .select({
      id: s.job.id,
      title: s.job.title,
      description: s.job.description,
      serviceTypeId: s.job.serviceTypeId,
      priority: s.job.priority,
      estimatedDurationMin: s.job.estimatedDurationMin,
      customerId: s.job.customerId,
      needsReview: s.job.needsReview,
      createdAt: s.job.createdAt,
    })
    .from(s.job)
    .where(
      and(
        eq(s.job.organizationId, ctx.orgId),
        eq(s.job.source, "portal"),
        sql`${s.job.deletedAt} is null`,
        sql`${s.job.createdAt} >= ${new Date(from)}`,
        sql`(${s.job.aiStatus} is null or ${s.job.aiStatus} in ('pending', 'drafting'))`,
      ),
    )
    .orderBy(s.job.createdAt, s.job.id);
  for (const j of portal) {
    const at = new Date(j.createdAt.getTime() + f.number.int({ min: 4, max: 25 }) * 1000);
    const roll = f.number.float({ min: 0, max: 1 });
    const outcome: AiOutcome = j.needsReview
      ? "drafted"
      : roll < 0.55
        ? "accepted"
        : roll < 0.9
          ? "edited"
          : "discarded";
    const draft = draftFor(j, j.needsReview ? "review" : outcome === "edited" ? "edited" : "same");
    rows.push({
      id: uuidv7(),
      organizationId: ctx.orgId,
      userId: null,
      jobId: j.id,
      feature: "intake",
      model: MODEL,
      ...usage(false),
      stopReason: "end_turn",
      outcome,
      output: draft,
      createdAt: at,
      updatedAt: at,
    });
  }
  if (portal.length) {
    for (let i = 0; i < portal.length; i += 500) {
      await ctx.tx
        .update(s.job)
        .set({ aiStatus: "drafted" })
        .where(
          and(
            eq(s.job.organizationId, ctx.orgId),
            inArray(
              s.job.id,
              portal.slice(i, i + 500).map((j) => j.id),
            ),
          ),
        );
    }
  }
  await insertBatches(ctx.tx, s.aiInteraction, rows);
}
