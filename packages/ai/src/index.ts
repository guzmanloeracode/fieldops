import type { IntakeModel, IntakeModelResult, ReportModel } from "@fieldops/core";
import { AnthropicIntakeModel } from "./anthropic";
import { FixtureIntakeModel } from "./fixture";
import { AnthropicReportModel, FixtureReportModel, unavailableReportModel } from "./report";

// AI providers behind the core's `IntakeModel` port (AI-01, ADR 013). The web app and the worker call
// `createIntakeModel` once with their environment.

export { AnthropicIntakeModel, DEFAULT_INTAKE_MODEL, describeError, type MessagesClient } from "./anthropic";
export { FixtureIntakeModel, fixtureDraft } from "./fixture";
export { catalogText, customerMessageText, INTAKE_SYSTEM_PROMPT } from "./prompt";
export {
  AnthropicReportModel,
  DEFAULT_REPORT_MODEL,
  FixtureReportModel,
  REPORT_SYSTEM_PROMPT,
  addMonths,
  fixtureReport,
  reportRecordText,
  unavailableReportModel,
} from "./report";

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
  /** AI_MODEL_REPORT: the model for service reports (AI-03). */
  reportModel?: string;
}

export function createIntakeModel(env: AiEnv): IntakeModel {
  if (env.provider === "fixture") return new FixtureIntakeModel();
  if (env.apiKey) return new AnthropicIntakeModel({ apiKey: env.apiKey, model: env.intakeModel });
  return unavailableModel;
}

/** The service report writer (AI-03), chosen the same way as the intake model. */
export function createReportModel(env: AiEnv): ReportModel {
  if (env.provider === "fixture") return new FixtureReportModel();
  if (env.apiKey) return new AnthropicReportModel({ apiKey: env.apiKey, model: env.reportModel });
  return unavailableReportModel;
}
