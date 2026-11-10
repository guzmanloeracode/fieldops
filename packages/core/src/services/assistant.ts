import {
  ASSISTANT_HISTORY_MESSAGES,
  ASSISTANT_MAX_TOOL_CALLS,
  ASSISTANT_RETENTION_DAYS,
  assistantAskSchema,
  type AiOutcome,
  type AssistantRole,
  type AssistantStreamEvent,
  type AssistantToolRun,
} from "@fieldops/shared";
import { dayOfWeek, localDateOf, localMinutesOf } from "../domain/availability";
import { NotFoundError, RateLimitedError, UnavailableError } from "../domain/errors";
import { assertCan, can } from "../domain/permissions";
import { applyAiRateLimits, monthStart } from "./ai";
import type { AiLimits, AiProvider, RateLimitStatus, TxRunner } from "./ai-types";
import { bindAssistantTools, uniqueRefs } from "./assistant-tools";
import type {
  AssistantContext,
  AssistantConversationRecord,
  AssistantMessageRecord,
  AssistantModel,
} from "./assistant-types";
import type { OrganizationRecord, ServiceContext } from "./types";
import { parseInput } from "./validate";

// Ask FieldOps (AI-02, PRD §9.3): a question is two short transactions with the model call between them, like
// intake. The first checks permission, the AI setting, the monthly quota and the rate limits, and saves the question;
// while the model streams, each tool call opens its own transaction; the last one logs the call and saves the
// answer with the tools that ran. Conversations are private to their user and kept 30 days.

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TITLE_MAX = 80;

export interface AskGuard {
  ip: string | null;
  limits: AiLimits;
}

/** What the first transaction prepared for the answer. */
export interface AskSession {
  conversationId: string;
  title: string;
  isNew: boolean;
  question: string;
  history: { role: AssistantRole; content: string }[];
  context: AssistantContext;
  quota: { used: number; limit: number };
  rateLimit: RateLimitStatus | null;
}

export type AskResult =
  | { ok: true; messageId: string; interactionId: string; conversationId: string }
  | { ok: false; reason: "refused" | "failed"; interactionId: string; conversationId: string };

/** The oldest moment a conversation can have been used and still be kept. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - ASSISTANT_RETENTION_DAYS * DAY_MS);
}

/** A conversation's title: the first line of its first question, shortened. */
export function conversationTitle(question: string): string {
  const line = question.trim().split("\n")[0]!.trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}

/**
 * The earlier turns sent with a new question: answered questions and their answers, alternating and starting
 * with a question. A question whose answer failed is left out.
 */
export function answeredTurns(messages: Pick<AssistantMessageRecord, "role" | "content">[]) {
  const out: { role: AssistantRole; content: string }[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i]!;
    const next = messages[i + 1]!;
    if (m.role === "user" && next.role === "assistant") {
      out.push({ role: "user", content: m.content }, { role: "assistant", content: next.content });
      i++;
    }
  }
  return out;
}

export function assistantContext(
  org: Pick<OrganizationRecord, "name" | "timezone" | "currency">,
  actor: ServiceContext["actor"],
  now: Date,
): AssistantContext {
  const today = localDateOf(now, org.timezone);
  const m = localMinutesOf(now, org.timezone);
  return {
    organizationName: org.name,
    timeZone: org.timezone,
    currency: org.currency,
    today,
    time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
    weekday: WEEKDAYS[dayOfWeek(today)]!,
    userName: actor.name,
    role: actor.role,
  };
}

type Availability = "disabled" | "not_configured" | "quota" | null;

function unavailableReason(org: OrganizationRecord, provider: AiProvider): Availability {
  if (!org.settings.ai.enabled) return "disabled";
  if (provider === "unavailable") return "not_configured";
  return null;
}

/** Whether the panel can ask, and why not otherwise, with this month's AI use. */
export async function assistantStatus(ctx: ServiceContext, provider: AiProvider) {
  assertCan(ctx.actor, "assistant.use");
  const org = await ctx.store.organization.get();
  const limit = org.settings.ai.monthlyQuota;
  const used = await ctx.store.ai.countSince(monthStart(ctx.now));
  const reason = unavailableReason(org, provider) ?? (used >= limit ? "quota" : null);
  return {
    available: reason === null,
    reason,
    used,
    limit,
    financial: can(ctx.actor, "dashboard.financial"),
  };
}

/**
 * The first transaction of a question: checks, then saves the question in a new or the user's own conversation.
 * Throws before anything is streamed, so the endpoint can answer with an ordinary problem response.
 */
export async function startAsk(
  run: TxRunner,
  model: Pick<AssistantModel, "provider">,
  raw: unknown,
  guard: AskGuard,
): Promise<AskSession> {
  return run(async (ctx) => {
    assertCan(ctx.actor, "assistant.use");
    const input = parseInput(assistantAskSchema, raw);
    const org = await ctx.store.organization.get();
    const reason = unavailableReason(org, model.provider);
    if (reason === "disabled") {
      throw new UnavailableError("AI features are turned off for this organization", { reason });
    }
    if (reason === "not_configured")
      throw new UnavailableError("AI isn't configured on this server", { reason });
    const quota = org.settings.ai.monthlyQuota;
    const used = await ctx.store.ai.countSince(monthStart(ctx.now));
    if (used >= quota) {
      throw new RateLimitedError("This month's AI quota is used up", {
        scope: "monthly_quota",
        limit: quota,
        resetAt: new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth() + 1, 1)),
      });
    }
    const rateLimit = await applyAiRateLimits(ctx, guard);
    let conversation: AssistantConversationRecord;
    let history: AskSession["history"] = [];
    if (input.conversation_id) {
      const found = await ctx.store.assistant.getConversation(input.conversation_id, ctx.actor.userId);
      if (!found) throw new NotFoundError("Conversation");
      conversation = found;
      history = answeredTurns(
        await ctx.store.assistant.listMessages(found.id, { last: ASSISTANT_HISTORY_MESSAGES }),
      );
    } else {
      conversation = await ctx.store.assistant.createConversation({
        userId: ctx.actor.userId,
        title: conversationTitle(input.message),
      });
    }
    await ctx.store.assistant.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: input.message,
      tools: [],
      aiInteractionId: null,
    });
    await ctx.store.assistant.touchConversation(conversation.id);
    return {
      conversationId: conversation.id,
      title: conversation.title,
      isNew: !input.conversation_id,
      question: input.message,
      history,
      context: assistantContext(org, ctx.actor, ctx.now),
      quota: { used: used + 1, limit: quota },
      rateLimit,
    };
  });
}

/**
 * Streams the answer to a prepared question through `emit`, then logs the call (feature "assistant") and saves
 * the answer with the tools that ran. Refusals and failures end with an `error` event; nothing is thrown for them.
 */
export async function streamAnswer(
  run: TxRunner,
  model: AssistantModel,
  session: AskSession,
  emit: (event: AssistantStreamEvent) => void,
  opts: { signal?: AbortSignal; onToolError?: (err: unknown) => void } = {},
): Promise<AskResult> {
  emit({ type: "conversation", conversation_id: session.conversationId, title: session.title });
  const runs: AssistantToolRun[] = [];
  const tools = bindAssistantTools(
    run,
    { role: session.context.role },
    {
      started: (callId, name) => emit({ type: "tool_started", call_id: callId, name }),
      finished: (callId, r) => {
        runs.push(r);
        emit({ type: "tool_finished", call_id: callId, ...r });
      },
      error: opts.onToolError,
    },
    ASSISTANT_MAX_TOOL_CALLS,
  );
  const result = await model.answer({
    context: session.context,
    history: session.history,
    question: session.question,
    tools,
    onText: (delta) => {
      if (delta) emit({ type: "text", delta });
    },
    signal: opts.signal,
  });
  const text = result.text.trim();
  const outcome: AiOutcome =
    result.kind === "refused" ? "refused" : result.kind === "answer" && text ? "drafted" : "failed";
  const error = result.kind === "answer" ? (text ? null : "Empty answer") : result.error;
  const saved = await run(async (ctx) => {
    const { id } = await ctx.store.ai.logInteraction({
      userId: ctx.actor.userId,
      jobId: null,
      feature: "assistant",
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      latencyMs: Math.round(result.latencyMs),
      stopReason: result.stopReason,
      outcome,
      output: { conversation_id: session.conversationId, tools: runs.map((r) => r.name) },
      error,
    });
    if (outcome !== "drafted") return { interactionId: id, messageId: null };
    const message = await ctx.store.assistant.addMessage({
      conversationId: session.conversationId,
      role: "assistant",
      content: text,
      tools: runs,
      aiInteractionId: id,
    });
    await ctx.store.assistant.touchConversation(session.conversationId);
    return { interactionId: id, messageId: message.id };
  });
  if (saved.messageId) {
    emit({ type: "done", message_id: saved.messageId, refs: uniqueRefs(runs.flatMap((r) => r.refs)) });
    return {
      ok: true,
      messageId: saved.messageId,
      interactionId: saved.interactionId,
      conversationId: session.conversationId,
    };
  }
  const reason = outcome === "refused" ? "refused" : "failed";
  emit({
    type: "error",
    code: reason,
    message:
      reason === "refused"
        ? "The assistant can't help with that request."
        : "The assistant couldn't answer. Try again in a moment.",
  });
  return { ok: false, reason, interactionId: saved.interactionId, conversationId: session.conversationId };
}

// ------------------------------------------------------------------ conversations (own only)

/** The user's conversations of the last 30 days, most recent first. */
export async function listConversations(ctx: ServiceContext, limit = 50) {
  assertCan(ctx.actor, "assistant.use");
  return ctx.store.assistant.listConversations(ctx.actor.userId, {
    since: retentionCutoff(ctx.now),
    limit: Math.min(Math.max(1, limit), 100),
  });
}

async function ownConversation(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "assistant.use");
  const c = UUID.test(id) ? await ctx.store.assistant.getConversation(id, ctx.actor.userId) : null;
  if (!c || c.updatedAt < retentionCutoff(ctx.now)) throw new NotFoundError("Conversation");
  return c;
}

export async function getConversation(ctx: ServiceContext, id: string) {
  const conversation = await ownConversation(ctx, id);
  const messages = await ctx.store.assistant.listMessages(conversation.id);
  return { conversation, messages };
}

export async function deleteConversation(ctx: ServiceContext, id: string): Promise<void> {
  const conversation = await ownConversation(ctx, id);
  await ctx.store.assistant.deleteConversation(conversation.id, ctx.actor.userId);
}
