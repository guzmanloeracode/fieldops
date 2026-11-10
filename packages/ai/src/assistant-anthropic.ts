import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type {
  AiUsage,
  AssistantModel,
  AssistantModelInput,
  AssistantModelResult,
  AssistantTool,
} from "@fieldops/core";
import { ASSISTANT_MAX_TOOL_CALLS } from "@fieldops/shared";
import { z } from "zod";
import { describeError, type MessagesClient } from "./anthropic";
import { ASSISTANT_SYSTEM_PROMPT, contextText } from "./assistant-prompt";

// Ask FieldOps on the Claude API (AI-02, §9.7), through the official SDK and from the server only.
// - The SDK's tool runner drives the loop over Zod-typed strict tools; each tool call runs in its own short
//   transaction on our side (see bindAssistantTools in the core). At most 8 calls run; the runner stops after 10
//   requests either way.
// - Streaming, so text reaches the panel as it is written; effort "medium".
// - Prompt caching: tool definitions and the system prompt first with a breakpoint, plus automatic caching of the
//   growing conversation tail across the tool loop.
// - `thread: false`: the full history goes with every request. Our database keeps the conversation, prompt caching
//   makes the repeated prefix cheap, and nothing is held on Anthropic's side between requests.
// - Refusals come back as a result, with server-side fallback; rate-limit and server errors use the SDK's retries.

export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_ITERATIONS = ASSISTANT_MAX_TOOL_CALLS + 2;
/** Re-issues of a turn whose streamed tool input wasn't parseable JSON. */
const MAX_JSON_RETRIES = 2;

/**
 * The tool's JSON schema for strict mode: generated from the Zod schema with every subschema inline, without the
 * `$schema` dialect, without the regex Zod adds next to `format: "date"` (the format says it already) and with
 * nullable types (`type: ["string", "null"]`) spelled as `anyOf`, then through the SDK's strict-mode transform
 * (constraints the API doesn't support move into the description).
 */
export function strictInputSchema(schema: z.ZodObject): Record<string, unknown> {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.type)) {
      const { type, description, ...rest } = n;
      const anyOf = (type as string[]).map((t) => (t === "null" ? { type: "null" } : { ...rest, type: t }));
      return clean(description === undefined ? { anyOf } : { anyOf, description });
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === "$schema" || (k === "pattern" && "format" in n)) continue;
      out[k] = clean(v);
    }
    return out;
  };
  const json = clean(z.toJSONSchema(schema, { reused: "inline", io: "input" }));
  return transformJSONSchema(json as Parameters<typeof transformJSONSchema>[0]) as Record<string, unknown>;
}

/**
 * An SDK runnable tool for one of our tools. The runner validates every input against the Zod schema before `run`
 * (and `execute` validates it again), so eager input streaming can't hand a tool a truncated input.
 */
export function toRunnableTool(tool: AssistantTool) {
  const runnable = betaZodTool({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input,
    run: (input) => tool.execute(input),
    strict: true,
    eager_input_streaming: true,
  });
  return { ...runnable, input_schema: strictInputSchema(tool.input) } as typeof runnable;
}

class TruncatedToolInput extends Error {}

export class AnthropicAssistantModel implements AssistantModel {
  readonly provider = "anthropic" as const;
  readonly model: string;
  private readonly client: MessagesClient;
  private readonly now: () => number;

  constructor(opts: { apiKey?: string; model?: string; client?: MessagesClient; now?: () => number }) {
    this.model = opts.model || DEFAULT_ASSISTANT_MODEL;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 });
    this.now = opts.now ?? (() => performance.now());
  }

  async answer(input: AssistantModelInput): Promise<AssistantModelResult> {
    const started = this.now();
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let text = "";
    let stopReason: string | null = null;
    let model = this.model;
    const info = () => ({ model, usage, stopReason, text, latencyMs: this.now() - started });
    const params = {
      model: this.model,
      max_tokens: 16_000,
      betas: [FALLBACK_BETA],
      fallbacks: "default" as const,
      output_config: { effort: "medium" as const },
      system: [
        {
          type: "text" as const,
          text: ASSISTANT_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const },
        },
        { type: "text" as const, text: contextText(input.context) },
      ],
      cache_control: { type: "ephemeral" as const },
      tools: input.tools.map(toRunnableTool),
      messages: [
        ...input.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: input.question },
      ],
      max_iterations: MAX_ITERATIONS,
      thread: false as const,
    };
    const options = { signal: input.signal };
    try {
      let runner = this.client.beta.messages.toolRunner({ ...params, stream: true }, options);
      for (let attempt = 0; ; attempt++) {
        try {
          for await (const stream of runner) {
            for await (const event of stream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                text += event.delta.text;
                input.onText(event.delta.text);
              }
            }
            const message = await stream.finalMessage();
            attempt = 0;
            usage.inputTokens += message.usage.input_tokens;
            usage.outputTokens += message.usage.output_tokens;
            usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
            usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
            stopReason = message.stop_reason;
            model = message.model;
            // A refusal can cut a tool call off mid-input: never run that turn's tools.
            if (message.stop_reason === "refusal") {
              return { kind: "refused", ...info(), error: message.stop_details?.category ?? null };
            }
            // A tool input cut off at max_tokens can still look valid: stop before the runner executes it.
            if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) {
              throw new TruncatedToolInput("A tool input was cut off (max_tokens)");
            }
          }
          break;
        } catch (err) {
          // Only a tool input that isn't parseable JSON (eager input streaming) is re-issued; the failed turn was
          // never added to runner.params, so finished tool calls don't run again.
          if (
            err instanceof Anthropic.APIError ||
            err instanceof TruncatedToolInput ||
            attempt >= MAX_JSON_RETRIES ||
            input.signal?.aborted
          ) {
            throw err;
          }
          runner = this.client.beta.messages.toolRunner({ ...runner.params, stream: true }, options);
        }
      }
      return { kind: "answer", ...info() };
    } catch (err) {
      return { kind: "failed", ...info(), error: describeError(err) };
    }
  }
}
