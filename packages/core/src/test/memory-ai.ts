import type { AiOutcome } from "@fieldops/shared";
import type { AiInteractionInput, AiRepo, AiUsageSummary } from "../services/ai-types";
import type { MemoryData } from "./memory-store";

/** An AI call as the in-memory store keeps it. */
export type MemoryAiInteraction = AiInteractionInput & { id: string; createdAt: Date };

/**
 * In-memory AiRepo (§9.7 usage log, PLT-04 rate limits). Rate-limit windows are kept per key and window start.
 * Calls are stamped with `clock()`, by default the fixed time `ctxFor` uses, so monthly counts are stable.
 */
export function memoryAi(
  interactions: MemoryAiInteraction[],
  rateLimits: Map<string, number>,
  data: MemoryData,
  uuid: () => string,
  clock: () => Date = () => new Date("2026-11-10T09:00:00Z"),
): AiRepo {
  const since = (d: Date) => interactions.filter((i) => i.createdAt >= d);
  return {
    async logInteraction(row) {
      const id = uuid();
      interactions.push({ ...row, id, createdAt: clock() });
      return { id };
    },
    async getInteraction(id) {
      const i = interactions.find((x) => x.id === id);
      return i
        ? {
            id: i.id,
            userId: i.userId,
            jobId: i.jobId,
            feature: i.feature,
            model: i.model,
            outcome: i.outcome,
            output: i.output,
            createdAt: i.createdAt,
          }
        : null;
    },
    async setOutcome(id, outcome, jobId) {
      const i = interactions.find((x) => x.id === id);
      if (!i || i.outcome !== "drafted") return false;
      i.outcome = outcome;
      if (jobId !== undefined) i.jobId = jobId;
      return true;
    },
    async countSince(d) {
      return since(d).length;
    },
    async usageSince(d): Promise<AiUsageSummary> {
      const rows = since(d);
      const outcomes = { drafted: 0, accepted: 0, edited: 0, discarded: 0, refused: 0, failed: 0 } as Record<
        AiOutcome,
        number
      >;
      for (const r of rows) outcomes[r.outcome] += 1;
      const sum = (f: (r: MemoryAiInteraction) => number) => rows.reduce((n, r) => n + f(r), 0);
      return {
        calls: rows.length,
        inputTokens: sum((r) => r.inputTokens),
        outputTokens: sum((r) => r.outputTokens),
        cacheReadTokens: sum((r) => r.cacheReadTokens),
        avgLatencyMs: rows.length ? Math.round(sum((r) => r.latencyMs) / rows.length) : 0,
        outcomes,
      };
    },
    async latestDraft(jobId) {
      const i = interactions.filter((x) => x.jobId === jobId && x.output !== null).at(-1);
      return i ? { ...i } : null;
    },
    async setJobStatus(jobId, status) {
      const j = data.jobs.find((x) => x.id === jobId);
      if (j) j.aiStatus = status;
    },
    async hitRateLimit(key, windowSeconds, now) {
      const start = Math.floor(now.getTime() / 1000 / windowSeconds) * windowSeconds;
      const k = `${key}@${start}`;
      const count = (rateLimits.get(k) ?? 0) + 1;
      rateLimits.set(k, count);
      return { count, resetAt: new Date((start + windowSeconds) * 1000) };
    },
  };
}
