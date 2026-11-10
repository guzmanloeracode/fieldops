import type { AssistantStreamEvent } from "@fieldops/shared";
import { describe, expect, it } from "vitest";
import { NotFoundError, RateLimitedError, UnavailableError, ValidationError } from "../domain/errors";
import { world } from "../test/fixtures";
import { assistantData } from "../test/memory-assistant";
import type { MemberRecord, ServiceContext } from "./types";
import type { AiLimits, TxRunner } from "./ai-types";
import type { AssistantModel, AssistantModelInput, AssistantModelResult } from "./assistant-types";
import * as assistant from "./assistant";

type World = ReturnType<typeof world>;

const NO_LIMITS: AiLimits = { perUserPerHour: 0, perVisitorPerDay: null, globalPerDay: 0 };
const guard = (limits: Partial<AiLimits> = {}) => ({ ip: null, limits: { ...NO_LIMITS, ...limits } });
const runner =
  (w: World, m: MemberRecord, extra: Partial<ServiceContext> = {}): TxRunner =>
  (fn) =>
    fn(w.ctx(m, extra));

const usage = { inputTokens: 7000, outputTokens: 300, cacheReadTokens: 6000, cacheWriteTokens: 0 };

/** A model that calls the given tools in order, then answers with `text` (or the given result kind). */
function scripted(
  calls: { tool: string; input: unknown }[],
  text: string,
  kind: AssistantModelResult["kind"] = "answer",
  provider: AssistantModel["provider"] = "fixture",
) {
  const seen: AssistantModelInput[] = [];
  const model: AssistantModel = {
    provider,
    model: "test-model",
    async answer(input) {
      seen.push(input);
      for (const c of calls) await input.tools.find((t) => t.name === c.tool)!.execute(c.input);
      input.onText(text.slice(0, 5));
      input.onText("");
      input.onText(text.slice(5));
      const base = { model: "test-model", usage, stopReason: "end_turn", latencyMs: 1234.4, text };
      if (kind === "refused") return { ...base, kind, error: "cyber" };
      if (kind === "failed") return { ...base, kind, error: "500 InternalServerError" };
      return { ...base, kind };
    },
  };
  return { model, seen };
}

async function ask(w: World, m: MemberRecord, model: AssistantModel, raw: unknown) {
  const run = runner(w, m);
  const session = await assistant.startAsk(run, model, raw, guard());
  const events: AssistantStreamEvent[] = [];
  const result = await assistant.streamAnswer(run, model, session, (e) => events.push(e));
  return { session, events, result };
}

const interactions = (w: World) => w.data.automate!.aiInteractions;

describe("helpers", () => {
  it("titles a conversation with the first line of its question", () => {
    expect(assistant.conversationTitle("  Who is free?\nMore detail")).toBe("Who is free?");
    const long = assistant.conversationTitle("x".repeat(120));
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("sends only answered questions as history", () => {
    expect(
      assistant.answeredTurns([
        { role: "user", content: "unanswered" },
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "assistant", content: "stray" },
        { role: "user", content: "q2" },
      ]),
    ).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("describes who is asking and when, in the organization's time zone", () => {
    const w = world();
    const ctx = assistant.assistantContext(
      { name: "Acme", timezone: "America/Chicago", currency: "USD" },
      w.ctx(w.dispatcher).actor,
      new Date("2026-11-10T04:30:00Z"),
    );
    expect(ctx).toEqual({
      organizationName: "Acme",
      timeZone: "America/Chicago",
      currency: "USD",
      today: "2026-11-09",
      time: "22:30",
      weekday: "Monday",
      userName: "Dan Dispatcher",
      role: "dispatcher",
    });
    expect(assistant.retentionCutoff(new Date("2026-11-10T00:00:00Z"))).toEqual(
      new Date("2026-10-11T00:00:00Z"),
    );
  });
});

describe("status", () => {
  it("says whether the panel can ask, and why not", async () => {
    const w = world();
    const ctx = w.ctx(w.tom);
    expect(await assistant.assistantStatus(ctx, "fixture")).toMatchObject({
      available: true,
      reason: null,
      used: 0,
      limit: 500,
      financial: false,
    });
    expect(await assistant.assistantStatus(w.ctx(w.owner), "unavailable")).toMatchObject({
      available: false,
      reason: "not_configured",
      financial: true,
    });
    w.data.org.settings.ai.monthlyQuota = 0;
    expect((await assistant.assistantStatus(ctx, "fixture")).reason).toBe("quota");
    w.data.org.settings.ai.enabled = false;
    expect((await assistant.assistantStatus(ctx, "fixture")).reason).toBe("disabled");
  });
});

describe("asking", () => {
  it("streams an answer with the tools that ran, logs the call and saves both messages", async () => {
    const w = world();
    const { model, seen } = scripted(
      [{ tool: "list_sla_risks", input: { states: null, due_by: null } }],
      "No open jobs are at risk.",
    );
    const { session, events, result } = await ask(w, w.dispatcher, model, {
      message: "  Which jobs are at risk?  ",
    });
    expect(session).toMatchObject({
      isNew: true,
      title: "Which jobs are at risk?",
      history: [],
      quota: { used: 1, limit: 500 },
    });
    expect(seen[0]!.question).toBe("Which jobs are at risk?");
    expect(seen[0]!.tools.map((t) => t.name)).not.toContain("revenue_summary");
    expect(seen[0]!.context).toMatchObject({
      role: "dispatcher",
      userName: "Dan Dispatcher",
      today: "2026-11-10",
    });
    expect(events.map((e) => e.type)).toEqual([
      "conversation",
      "tool_started",
      "tool_finished",
      "text",
      "text",
      "done",
    ]);
    expect(events[2]).toMatchObject({
      type: "tool_finished",
      name: "list_sla_risks",
      ok: true,
      count: 0,
      refs: [],
    });
    expect(result).toMatchObject({ ok: true, conversationId: session.conversationId });

    expect(interactions(w)).toEqual([
      expect.objectContaining({
        feature: "assistant",
        userId: w.dispatcher.userId,
        outcome: "drafted",
        latencyMs: 1234,
        inputTokens: 7000,
        cacheReadTokens: 6000,
        error: null,
        output: { conversation_id: session.conversationId, tools: ["list_sla_risks"] },
      }),
    ]);
    const saved = assistantData(w.data).messages;
    expect(saved.map((m) => [m.role, m.content])).toEqual([
      ["user", "Which jobs are at risk?"],
      ["assistant", "No open jobs are at risk."],
    ]);
    expect(saved[1]!.tools).toEqual([
      expect.objectContaining({ name: "list_sla_risks", summary: expect.any(String) }),
    ]);
    expect(saved[1]!.aiInteractionId).toBe(interactions(w)[0]!.id);
  });

  it("continues the user's own conversation with its history", async () => {
    const w = world();
    const first = await ask(w, w.dispatcher, scripted([], "Answer one.").model, {
      message: "First question",
    });
    const { model, seen } = scripted([], "Answer two.");
    const next = await ask(w, w.dispatcher, model, {
      message: "Second question",
      conversation_id: first.session.conversationId,
    });
    expect(next.session).toMatchObject({ isNew: false, title: "First question" });
    expect(seen[0]!.history).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "Answer one." },
    ]);
    // Someone else can't continue it.
    await expect(
      assistant.startAsk(
        runner(w, w.owner),
        model,
        { message: "Hi", conversation_id: first.session.conversationId },
        guard(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ends refusals and failures with an error event and saves no answer", async () => {
    const w = world();
    const refused = await ask(w, w.owner, scripted([], "", "refused").model, { message: "Something" });
    expect(refused.events.at(-1)).toEqual({ type: "error", code: "refused", message: expect.any(String) });
    expect(refused.result).toMatchObject({ ok: false, reason: "refused" });
    const failed = await ask(w, w.owner, scripted([], "partial", "failed").model, {
      message: "Something else",
    });
    expect(failed.events.at(-1)).toMatchObject({ type: "error", code: "failed" });
    const empty = await ask(w, w.owner, scripted([], "   ").model, { message: "A third thing" });
    expect(empty.result).toMatchObject({ ok: false, reason: "failed" });
    expect(interactions(w).map((i) => [i.outcome, i.error])).toEqual([
      ["refused", "cyber"],
      ["failed", "500 InternalServerError"],
      ["failed", "Empty answer"],
    ]);
    expect(assistantData(w.data).messages.every((m) => m.role === "user")).toBe(true);
  });

  it("checks the question, the AI setting, the quota and the rate limits before saving anything", async () => {
    const w = world();
    const { model } = scripted([], "ok");
    const run = runner(w, w.tom);
    await expect(assistant.startAsk(run, model, { message: "  " }, guard())).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      assistant.startAsk(run, scripted([], "", "answer", "unavailable").model, { message: "Hi" }, guard()),
    ).rejects.toMatchObject({ details: { reason: "not_configured" } });
    await assistant.startAsk(run, model, { message: "One" }, guard({ perUserPerHour: 1 }));
    await expect(
      assistant.startAsk(run, model, { message: "Two" }, guard({ perUserPerHour: 1 })),
    ).rejects.toBeInstanceOf(RateLimitedError);
    w.data.org.settings.ai.monthlyQuota = 0;
    await expect(assistant.startAsk(run, model, { message: "Three" }, guard())).rejects.toMatchObject({
      limit: { scope: "monthly_quota", resetAt: new Date("2026-12-01T00:00:00Z") },
    });
    w.data.org.settings.ai.enabled = false;
    await expect(assistant.startAsk(run, model, { message: "Four" }, guard())).rejects.toBeInstanceOf(
      UnavailableError,
    );
    expect(assistantData(w.data).messages.map((m) => m.content)).toEqual(["One"]);
  });
});

describe("conversations", () => {
  it("lists, opens and deletes only the user's own conversations of the last 30 days", async () => {
    const w = world();
    const { model } = scripted([], "An answer.");
    const mine = await ask(w, w.dispatcher, model, { message: "Mine" });
    await ask(w, w.owner, model, { message: "Theirs" });
    const old = assistantData(w.data).conversations.find((c) => c.id === mine.session.conversationId)!;
    const ctx = w.ctx(w.dispatcher);

    expect((await assistant.listConversations(ctx)).map((c) => c.title)).toEqual(["Mine"]);
    const detail = await assistant.getConversation(ctx, old.id);
    expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    await expect(assistant.getConversation(w.ctx(w.owner), old.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assistant.getConversation(ctx, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(assistant.deleteConversation(w.ctx(w.owner), old.id)).rejects.toBeInstanceOf(NotFoundError);

    // Past retention, it's gone from every view even before the nightly delete.
    const later = w.ctx(w.dispatcher, { now: new Date("2026-12-31T00:00:00Z") });
    expect(await assistant.listConversations(later, 500)).toEqual([]);
    await expect(assistant.getConversation(later, old.id)).rejects.toBeInstanceOf(NotFoundError);

    await assistant.deleteConversation(ctx, old.id);
    expect(await assistant.listConversations(ctx)).toEqual([]);
    expect(assistantData(w.data).messages.some((m) => m.conversationId === old.id)).toBe(false);
  });
});
