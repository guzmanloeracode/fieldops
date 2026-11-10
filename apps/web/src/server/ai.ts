import "server-only";
import { createAssistantModel, createIntakeModel } from "@fieldops/ai";
import type { AiLimits, TxRunner } from "@fieldops/core";
import { env } from "@/env";
import { runService, type ResolvedActor } from "./context";
import { requestMeta } from "./request-meta";

// AI wiring for the web app (AI-01, §9.7): one intake model per process, chosen from the environment, and the
// rate limits for AI routes (PLT-04). The model is called from the server only; the key never reaches a browser.

export const intakeModel = createIntakeModel({
  apiKey: env.ANTHROPIC_API_KEY,
  provider: env.AI_PROVIDER,
  intakeModel: env.AI_MODEL_INTAKE,
});

/** Ask FieldOps (AI-02): Claude with read-only tools, the fixture for E2E, or "not configured". */
export const assistantModel = createAssistantModel({
  apiKey: env.ANTHROPIC_API_KEY,
  provider: env.AI_PROVIDER,
  assistantModel: env.AI_MODEL_ASSISTANT,
});

export const aiLimits: AiLimits = {
  perUserPerHour: env.AI_USER_HOURLY_LIMIT,
  // Per-visitor limits protect the public demo, where everyone shares the same accounts (DEM-05).
  perVisitorPerDay: env.DEMO_MODE ? env.AI_VISITOR_DAILY_LIMIT : null,
  globalPerDay: env.AI_DAILY_LIMIT,
};

/** Each call opens its own short transaction as the member, so the model call between them holds none. */
export function txRunner(actor: ResolvedActor): TxRunner {
  return (fn) => runService(fn, actor);
}

export async function aiGuard(ip?: string | null) {
  return { ip: ip === undefined ? (await requestMeta()).ip : ip, limits: aiLimits };
}
