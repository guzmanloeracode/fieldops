"use server";
import { ai, formatJobNumber } from "@fieldops/core";
import type { JobReviewInput } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

/** Applies chosen AI draft fields to a portal request and/or confirms it (AI-01). */
export async function reviewJobAction(jobId: string, input: JobReviewInput) {
  const result = await action(() => runService((ctx) => ai.reviewJob(ctx, jobId, input)));
  if (!result.ok) return result;
  revalidatePath(`/jobs/${formatJobNumber(result.data.job.number)}`);
  revalidatePath("/jobs");
  return { ok: true as const, data: { applied: result.data.applied } };
}
