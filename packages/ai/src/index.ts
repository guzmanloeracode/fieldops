import type { AssistantModel, AssistantModelResult, IntakeModel, IntakeModelResult } from "@fieldops/core";
import { AnthropicIntakeModel } from "./anthropic";
import { AnthropicAssistantModel } from "./assistant-anthropic";
import { FixtureAssistantModel } from "./assistant-fixture";
import { FixtureIntakeModel } from "./fixture";

// AI providers behind the core's `IntakeModel` port (AI-01, ADR 013). The web app and the worker call
// `createIntakeModel` once with their environment.

export { AnthropicIntakeModel, DEFAULT_INTAKE_MODEL, describeError, type MessagesClient } from "./anthropic";
export { FixtureIntakeModel, fixtureDraft } from "./fixture";
export { catalogText, customerMessageText, INTAKE_SYSTEM_PROMPT } from "./prompt";
export {
  AnthropicAssistantModel,
  DEFAULT_ASSISTANT_MODEL,
  strictInputSchema,
  toRunnableTool,
} from "./assistant-anthropic";
export { FixtureAssistantModel, fixtureAnswer, monthRange, planAssistantTools } from "./assistant-fixture";
export { ASSISTANT_SYSTEM_PROMPT, contextText } from "./assistant-prompt";

/** No key and no fixture: every call fails, and the core reports AI as not configured before calling it. */
export const unavailableModel: IntakeModel = {
  provider: "unavailable",
  model: "none",
  async draft(): Promise<IntakeModelResult> {
    return {
      kind: "failed",
      model: "none",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: null,
      latencyMs: 0,
      error: "AI isn't configured",
    };
  },
};

export interface AiEnv {
  /** ANTHROPIC_API_KEY */
  apiKey?: string;
  /** AI_PROVIDER: "fixture" selects the test double; anything else uses Claude when a key is set. */
  provider?: string;
  /** AI_MODEL_INTAKE: the model for intake, without code changes (§9.7). */
  intakeModel?: string;
  /** AI_MODEL_ASSISTANT: the model for Ask FieldOps (AI-02). */
  assistantModel?: string;
}

export function createIntakeModel(env: AiEnv): IntakeModel {
  if (env.provider === "fixture") return new FixtureIntakeModel();
  if (env.apiKey) return new AnthropicIntakeModel({ apiKey: env.apiKey, model: env.intakeModel });
  return unavailableModel;
}

/** Ask FieldOps without a key or fixture: the core reports AI as not configured before calling it. */
export const unavailableAssistantModel: AssistantModel = {
  provider: "unavailable",
  model: "none",
  async answer(): Promise<AssistantModelResult> {
    return {
      kind: "failed",
      model: "none",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: null,
      latencyMs: 0,
      text: "",
      error: "AI isn't configured",
    };
  },
};

export function createAssistantModel(env: AiEnv): AssistantModel {
  if (env.provider === "fixture") return new FixtureAssistantModel();
  if (env.apiKey) return new AnthropicAssistantModel({ apiKey: env.apiKey, model: env.assistantModel });
  return unavailableAssistantModel;
}
