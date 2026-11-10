"use server";
import { ai, formatJobNumber } from "@fieldops/core";
import type { AiCustomerSuggestion, IntakeDraft, JobCreateInput } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { aiGuard, intakeModel, txRunner } from "@/server/ai";
import { action, requireActor, runService } from "@/server/context";

// Server actions for the "AI draft" panel on the new job form (AI-01).

export interface DraftView {
  status: "drafted" | "refused" | "failed";
  interactionId: string;
  draft: IntakeDraft | null;
  suggestions: AiCustomerSuggestion[];
  quota: { used: number; limit: number };
}

export async function draftJobAction(input: unknown) {
  return action(async (): Promise<DraftView> => {
    const actor = await requireActor();
    const r = await ai.draftIntake(txRunner(actor), intakeModel, input, await aiGuard());
    return {
      status: r.ok ? "drafted" : r.reason,
      interactionId: r.interactionId,
      draft: r.ok ? r.draft : null,
      suggestions: r.ok ? r.customerSuggestions : [],
      quota: r.quota,
    };
  });
}

export async function createJobFromDraftAction(input: {
  interaction_id: string;
  checklist: string[];
  job: JobCreateInput;
}) {
  const result = await action(() => runService((ctx) => ai.createJobFromDraft(ctx, input)));
  if (!result.ok) {
    // Field errors come back as "job.title"; the form knows them as "title".
    const fields = result.error.fields?.map((f) => ({ ...f, path: f.path.replace(/^job\./, "") }));
    return { ok: false as const, error: { ...result.error, fields } };
  }
  revalidatePath("/jobs");
  return { ok: true as const, data: { number: formatJobNumber(result.data.job.number) } };
}

/** The dispatcher closed the draft and fills in the form by hand. */
export async function discardDraftAction(interactionId: string) {
  return action(() =>
    runService((ctx) => ai.recordOutcome(ctx, interactionId, { outcome: "discarded" })).then(() => null),
  );
}
