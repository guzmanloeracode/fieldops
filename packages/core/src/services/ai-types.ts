import type { AiFeature, AiOutcome } from "@fieldops/shared";

// AI usage logging (§9.7) and smart intake (AI-01). The AI slice extends these contracts.

export interface AiInteractionInput {
  userId: string | null;
  jobId: string | null;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  stopReason: string | null;
  outcome: AiOutcome;
  output: unknown;
  error: string | null;
}

export interface AiRepo {
  logInteraction(row: AiInteractionInput): Promise<{ id: string }>;
}
