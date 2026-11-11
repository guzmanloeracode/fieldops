import { assistantToolInputs, type AssistantToolName } from "@fieldops/shared";
import { z } from "zod";
import { DomainError } from "../domain/errors";
import type { Actor } from "../domain/permissions";
import type { TxRunner } from "./ai-types";
import { ASSISTANT_TOOLS, toolsFor, type ToolResult } from "./assistant-tools";
import type { ServiceContext } from "./types";

// The MCP server's tools (PLT-05, AI-05, ADR 024): the read-only Ask FieldOps tools, offered to an MCP client that
// authenticated with an API key. They run exactly as the assistant runs them: each call in its own short tenant
// transaction as the key's member, filtered by that member's role, capped at 50 rows. No model of ours is involved,
// so they spend no AI quota.

/**
 * The assistant's inputs are strict for Claude (every field present, null when unused). MCP clients may leave
 * those fields out, so a field that accepts null is optional here and filled with null before the real schema
 * validates the call.
 */
export function mcpInputSchema(name: AssistantToolName): z.ZodObject {
  const schema = assistantToolInputs[name];
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    shape[key] = field.safeParse(null).success ? field.optional() : field;
  }
  return z.object(shape);
}

function withNulls(name: AssistantToolName, raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const filled: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const [key, field] of Object.entries(assistantToolInputs[name].shape as Record<string, z.ZodType>)) {
    if (filled[key] === undefined && field.safeParse(null).success) filled[key] = null;
  }
  return filled;
}

export interface McpToolDef {
  name: AssistantToolName;
  description: string;
}

/** The tools the member's role may use, in the assistant's fixed order. */
export function mcpToolsFor(actor: Pick<Actor, "role">): McpToolDef[] {
  return toolsFor(actor).map((name) => ({ name, description: ASSISTANT_TOOLS[name].description }));
}

export type McpToolOutcome =
  | { ok: true; summary: string; count: number; data: Record<string, unknown> }
  | { ok: false; error: string; issues?: { path: string; message: string }[] };

/**
 * Runs one tool for the member. Invalid input and domain errors (a job that doesn't exist, a tool the role can't
 * use) come back as results the client can show; anything else is thrown for the caller to log.
 */
export async function runMcpTool(
  run: TxRunner,
  actor: Pick<Actor, "role">,
  name: string,
  raw: unknown,
): Promise<McpToolOutcome> {
  const tool = (toolsFor(actor) as string[]).includes(name) ? (name as AssistantToolName) : null;
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  const parsed = assistantToolInputs[tool].safeParse(withNulls(tool, raw ?? {}));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input",
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const def = ASSISTANT_TOOLS[tool] as { run: (ctx: ServiceContext, input: unknown) => Promise<ToolResult> };
  try {
    const result = await run((ctx) => def.run(ctx, parsed.data));
    return { ok: true, summary: result.summary, count: result.count, data: result.data };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
