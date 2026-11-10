import type { AiInteractionRecord, AiRepo, AiUsageSummary } from "@fieldops/core";
import { AI_OUTCOMES, type AiFeature, type AiOutcome } from "@fieldops/shared";
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { aiInteraction, job, rateLimit } from "../schema";

// AI usage log (§9.7), intake drafts (AI-01) and the rate-limit counters (PLT-04).

function toRecord(r: typeof aiInteraction.$inferSelect): AiInteractionRecord {
  return {
    id: r.id,
    userId: r.userId,
    jobId: r.jobId,
    feature: r.feature as AiFeature,
    model: r.model,
    outcome: r.outcome as AiOutcome,
    output: r.output,
    createdAt: r.createdAt,
  };
}

export function aiRepo(tx: Tx, orgId: string): AiRepo {
  const scope = eq(aiInteraction.organizationId, orgId);
  return {
    async logInteraction(row) {
      const [r] = await tx
        .insert(aiInteraction)
        .values({ organizationId: orgId, ...row, output: row.output ?? null })
        .returning({ id: aiInteraction.id });
      return { id: r!.id };
    },

    async getInteraction(id) {
      const [r] = await tx
        .select()
        .from(aiInteraction)
        .where(and(scope, eq(aiInteraction.id, id)));
      return r ? toRecord(r) : null;
    },

    async setOutcome(id, outcome, jobId) {
      const rows = await tx
        .update(aiInteraction)
        .set({ outcome, ...(jobId !== undefined ? { jobId } : {}), updatedAt: new Date() })
        .where(and(scope, eq(aiInteraction.id, id), eq(aiInteraction.outcome, "drafted")))
        .returning({ id: aiInteraction.id });
      return rows.length > 0;
    },

    async countSince(since) {
      const [r] = await tx
        .select({ n: count() })
        .from(aiInteraction)
        .where(and(scope, gte(aiInteraction.createdAt, since)));
      return r?.n ?? 0;
    },

    async usageSince(since): Promise<AiUsageSummary> {
      const rows = await tx
        .select({
          outcome: aiInteraction.outcome,
          calls: count(),
          inputTokens: sql<number>`coalesce(sum(${aiInteraction.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${aiInteraction.outputTokens}), 0)::int`,
          cacheReadTokens: sql<number>`coalesce(sum(${aiInteraction.cacheReadTokens}), 0)::int`,
          latencyMs: sql<number>`coalesce(sum(${aiInteraction.latencyMs}), 0)::bigint`,
        })
        .from(aiInteraction)
        .where(and(scope, gte(aiInteraction.createdAt, since)))
        .groupBy(aiInteraction.outcome);
      const outcomes = Object.fromEntries(AI_OUTCOMES.map((o) => [o, 0])) as Record<AiOutcome, number>;
      let calls = 0;
      let latency = 0;
      const out = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
      for (const r of rows) {
        if (r.outcome in outcomes) outcomes[r.outcome as AiOutcome] += r.calls;
        calls += r.calls;
        latency += Number(r.latencyMs);
        out.inputTokens += r.inputTokens;
        out.outputTokens += r.outputTokens;
        out.cacheReadTokens += r.cacheReadTokens;
      }
      return { calls, ...out, avgLatencyMs: calls ? Math.round(latency / calls) : 0, outcomes };
    },

    async latestDraft(jobId) {
      const [r] = await tx
        .select()
        .from(aiInteraction)
        .where(and(scope, eq(aiInteraction.jobId, jobId), isNotNull(aiInteraction.output)))
        .orderBy(desc(aiInteraction.createdAt), desc(aiInteraction.id))
        .limit(1);
      return r ? toRecord(r) : null;
    },

    async setJobStatus(jobId, status) {
      // Not an edit of the job: no version bump, and the audit trigger ignores ai_status.
      await tx
        .update(job)
        .set({ aiStatus: status })
        .where(and(eq(job.organizationId, orgId), eq(job.id, jobId)));
    },

    async hitRateLimit(key, windowSeconds, now) {
      const startMs = Math.floor(now.getTime() / 1000 / windowSeconds) * windowSeconds * 1000;
      const [r] = await tx
        .insert(rateLimit)
        .values({ key, windowStart: new Date(startMs), count: 1 })
        .onConflictDoUpdate({
          target: [rateLimit.key, rateLimit.windowStart],
          set: { count: sql`${rateLimit.count} + 1` },
        })
        .returning({ count: rateLimit.count });
      return { count: r!.count, resetAt: new Date(startMs + windowSeconds * 1000) };
    },
  };
}
