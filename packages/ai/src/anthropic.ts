import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AiUsage, IntakeModel, IntakeModelInput, IntakeModelResult } from "@fieldops/core";
import { intakeModelOutputSchema } from "@fieldops/shared";
import { catalogText, customerMessageText, INTAKE_SYSTEM_PROMPT } from "./prompt";

// Smart intake on the Claude API (AI-01, §9.7), through the official SDK and from the server only.
// - Structured output constrained to the shared Zod schema; the core validates and clamps it again.
// - Effort "low": intake is extraction and classification, and it has to answer in a few seconds.
// - Stable content first (system prompt, then the organization's catalog with a cache breakpoint), the message last.
// - Refusals come back as a result, with server-side fallback to Anthropic's default model for the category.
// - Rate-limit and server errors use the SDK's retries; anything else falls back to the manual form.

export const DEFAULT_INTAKE_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The part of the SDK client this module calls; tests pass a fake. */
export type MessagesClient = Pick<Anthropic, "beta">;

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export class AnthropicIntakeModel implements IntakeModel {
  readonly provider = "anthropic" as const;
  readonly model: string;
  private readonly client: MessagesClient;
  private readonly now: () => number;

  constructor(opts: { apiKey?: string; model?: string; client?: MessagesClient; now?: () => number }) {
    this.model = opts.model || DEFAULT_INTAKE_MODEL;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 30_000 });
    this.now = opts.now ?? (() => performance.now());
  }

  async draft(input: IntakeModelInput): Promise<IntakeModelResult> {
    const started = this.now();
    const elapsed = () => this.now() - started;
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 8000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(intakeModelOutputSchema) },
        system: [
          { type: "text", text: INTAKE_SYSTEM_PROMPT },
          { type: "text", text: catalogText(input.catalog), cache_control: { type: "ephemeral" } },
        ],
        messages: [
          {
            role: "user",
            content: [
              ...input.photos.map((p) => ({
                type: "image" as const,
                source: { type: "base64" as const, media_type: p.mediaType, data: p.data },
              })),
              { type: "text" as const, text: customerMessageText(input.message, input.photos.length) },
            ],
          },
        ],
      });
      const info = {
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        },
        stopReason: response.stop_reason,
        latencyMs: elapsed(),
      };
      if (response.stop_reason === "refusal") {
        return { kind: "refused", ...info, error: response.stop_details?.category ?? null };
      }
      if (response.stop_reason === "max_tokens" || !response.parsed_output) {
        return { kind: "failed", ...info, error: `No usable output (${response.stop_reason})` };
      }
      return { kind: "draft", ...info, output: response.parsed_output };
    } catch (err) {
      return {
        kind: "failed",
        model: this.model,
        usage: NO_USAGE,
        stopReason: null,
        latencyMs: elapsed(),
        error: describeError(err),
      };
    }
  }
}

/** A short, log-safe description of an SDK error; never includes the request. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `${err.status ?? "network"} ${err.name}`.slice(0, 300);
  if (err instanceof Error) return err.message.slice(0, 300);
  return "Unknown error";
}
