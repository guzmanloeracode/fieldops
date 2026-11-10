"use client";
import {
  ASSISTANT_STARTERS,
  type AssistantConversationDto,
  type AssistantMessageDto,
  type AssistantRecordRef,
  type AssistantToolName,
  type AssistantToolRun,
} from "@fieldops/shared";
import { Check, History, Loader2, Plus, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  assistantConversationAction,
  assistantStatusAction,
  deleteAssistantConversationAction,
} from "@/app/(app)/assistant-actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarkdownLite, plainText } from "./markdown-lite";
import { readAssistantEvents } from "./stream";

// Ask FieldOps (AI-02, PRD §9.3): a chat panel for every role, opened with ⌘J / Ctrl+J or the header button. The
// answer streams in; the tools that ran show as chips ("Looked up 12 jobs"), and every record the answer mentions
// links to its page. A polite live region announces what the tools found and the finished answer, not every
// fragment of text.

const OPEN_EVENT = "fieldops:open-assistant";

/** Opens the panel (the header buttons; ⌘J / Ctrl+J works anywhere). */
export function openAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function AssistantButton({ className }: { className?: string }) {
  const t = useTranslations("assistant");
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  const label = `${t("open")} (${mac ? "⌘J" : "Ctrl+J"})`;
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("shrink-0", className)}
      onClick={openAssistant}
      aria-label={t("open")}
      title={label}
      aria-keyshortcuts="Control+J Meta+J"
      data-testid="assistant-open"
    >
      <Sparkles />
    </Button>
  );
}

type ToolChip = { callId: string; name: AssistantToolName; done: boolean; ok: boolean; count: number };
type ErrorCode =
  | "refused"
  | "failed"
  | "network"
  | "quota"
  | "rateLimited"
  | "disabled"
  | "notConfigured"
  | "notFound"
  | "invalid"
  | "noAnswer";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolChip[];
  refs: AssistantRecordRef[];
  state: "streaming" | "done" | "error";
  error?: ErrorCode;
}

interface Status {
  available: boolean;
  reason: "disabled" | "not_configured" | "quota" | null;
  conversations: AssistantConversationDto[];
}

const chipsFrom = (runs: AssistantToolRun[]): ToolChip[] =>
  runs.map((r, i) => ({ callId: `saved_${i}`, name: r.name, done: true, ok: r.ok, count: r.count }));

/** Saved messages as chat messages; a question without a saved answer gets a note. */
function fromSaved(messages: AssistantMessageDto[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  messages.forEach((m, i) => {
    out.push({
      id: m.id,
      role: m.role,
      content: m.content,
      tools: chipsFrom(m.tools),
      refs: m.tools.flatMap((r) => r.refs),
      state: "done",
    });
    if (m.role === "user" && messages[i + 1]?.role !== "assistant") {
      out.push({
        id: `${m.id}-none`,
        role: "assistant",
        content: "",
        tools: [],
        refs: [],
        state: "error",
        error: "noAnswer",
      });
    }
  });
  return out;
}

/** Which message to show for a problem response from the endpoint. */
async function problemCode(res: Response): Promise<ErrorCode> {
  const body = (await res.json().catch(() => null)) as { reason?: string; scope?: string } | null;
  if (res.status === 429) return body?.scope === "monthly_quota" ? "quota" : "rateLimited";
  if (res.status === 503) return body?.reason === "disabled" ? "disabled" : "notConfigured";
  if (res.status === 404) return "notFound";
  if (res.status === 422) return "invalid";
  return "failed";
}

export function AssistantPanel() {
  const t = useTranslations("assistant");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    const res = await assistantStatusAction();
    if (res.ok) setStatus(res.data);
    else setStatus({ available: false, reason: null, conversations: [] });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) void loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Stop a running answer when the panel goes away.
  useEffect(() => () => abort.current?.abort(), []);

  const update = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const answerId = `answer-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `question-${Date.now()}`, role: "user", content: text, tools: [], refs: [], state: "done" },
      { id: answerId, role: "assistant", content: "", tools: [], refs: [], state: "streaming" },
    ]);
    setInput("");
    setBusy(true);
    setAnnouncement(t("thinking"));
    const controller = new AbortController();
    abort.current = controller;
    const fail = (error: ErrorCode) => {
      update(answerId, (m) => ({ ...m, state: "error", error }));
      setAnnouncement(t(`error.${error}`));
    };
    try {
      const res = await fetch("/api/v1/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const code = await problemCode(res);
        if (code === "notFound") setConversationId(null);
        fail(code);
        return;
      }
      let finished = false;
      let answer = "";
      for await (const e of readAssistantEvents(res)) {
        switch (e.type) {
          case "conversation":
            setConversationId(e.conversation_id);
            setStatus((s) =>
              s && !s.conversations.some((c) => c.id === e.conversation_id)
                ? {
                    ...s,
                    conversations: [
                      {
                        id: e.conversation_id,
                        title: e.title,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                      ...s.conversations,
                    ],
                  }
                : s,
            );
            break;
          case "text":
            answer += e.delta;
            update(answerId, (m) => ({ ...m, content: m.content + e.delta }));
            break;
          case "tool_started":
            update(answerId, (m) => ({
              ...m,
              tools: [...m.tools, { callId: e.call_id, name: e.name, done: false, ok: true, count: 0 }],
            }));
            setAnnouncement(t(`tool.running.${e.name}`));
            break;
          case "tool_finished":
            update(answerId, (m) => ({
              ...m,
              tools: m.tools.map((c) =>
                c.callId === e.call_id ? { ...c, done: true, ok: e.ok, count: e.count } : c,
              ),
              refs: [...m.refs, ...e.refs],
            }));
            setAnnouncement(e.ok ? t(`tool.done.${e.name}`, { count: e.count }) : t("tool.failed"));
            break;
          case "done":
            finished = true;
            update(answerId, (m) => ({ ...m, id: e.message_id, state: "done", refs: e.refs }));
            setAnnouncement(plainText(answer));
            break;
          case "error":
            finished = true;
            fail(e.code);
            break;
        }
      }
      if (!finished) fail("network");
    } catch {
      fail(controller.signal.aborted ? "failed" : "network");
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const stop = () => abort.current?.abort();

  const startNew = () => {
    stop();
    setConversationId(null);
    setMessages([]);
    setView("chat");
    setAnnouncement("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openConversation = async (c: AssistantConversationDto) => {
    stop();
    const res = await assistantConversationAction(c.id);
    if (!res.ok) {
      setStatus((s) => (s ? { ...s, conversations: s.conversations.filter((x) => x.id !== c.id) } : s));
      setAnnouncement(t("error.notFound"));
      return;
    }
    setConversationId(res.data.id);
    setMessages(fromSaved(res.data.messages));
    setView("chat");
    setAnnouncement(t("history.opened", { title: res.data.title }));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const remove = async (c: AssistantConversationDto) => {
    const res = await deleteAssistantConversationAction(c.id);
    if (!res.ok && res.error.code !== "not_found") return;
    setStatus((s) => (s ? { ...s, conversations: s.conversations.filter((x) => x.id !== c.id) } : s));
    if (conversationId === c.id) {
      setConversationId(null);
      setMessages([]);
    }
    setAnnouncement(t("history.deleted", { title: c.title }));
  };

  const unavailable = status && !status.available ? status.reason : undefined;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-lg"
        data-testid="assistant-panel"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="text-primary size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-base">{t("title")}</SheetTitle>
            <SheetDescription className="text-xs">{t("description")}</SheetDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={view === "history" ? t("history.back") : t("history.title")}
            aria-pressed={view === "history"}
            title={view === "history" ? t("history.back") : t("history.title")}
            onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
            data-testid="assistant-history-toggle"
          >
            <History />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("newConversation")}
            title={t("newConversation")}
            onClick={startNew}
            data-testid="assistant-new"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("close")}
            title={t("close")}
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
        </header>

        <div role="status" aria-live="polite" className="sr-only" data-testid="assistant-live">
          {announcement}
        </div>

        {view === "history" ? (
          <section
            aria-labelledby="assistant-history-title"
            className="flex-1 overflow-y-auto px-4 py-3"
            data-testid="assistant-history"
          >
            <h3 id="assistant-history-title" className="mb-2 text-sm font-semibold">
              {t("history.title")}
            </h3>
            {!status ? (
              <p className="text-muted-foreground text-sm">{t("loading")}</p>
            ) : status.conversations.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("history.empty")}</p>
            ) : (
              <ul className="divide-y">
                {status.conversations.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-2">
                    <button
                      type="button"
                      onClick={() => void openConversation(c)}
                      className="hover:bg-accent focus-visible:ring-ring/50 min-w-0 flex-1 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
                    >
                      <span className="block truncate text-sm font-medium">{c.title}</span>
                      <span className="text-muted-foreground block text-xs">
                        {formatRelative(c.updated_at)}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("history.delete", { title: c.title })}
                      title={t("history.delete", { title: c.title })}
                      onClick={() => void remove(c)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground mt-3 text-xs">{t("history.retention")}</p>
          </section>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="assistant-messages">
              {unavailable !== undefined ? (
                <p className="bg-muted rounded-md p-3 text-sm" data-testid="assistant-unavailable">
                  {unavailable === "disabled"
                    ? t("error.disabled")
                    : unavailable === "quota"
                      ? t("error.quota")
                      : t("error.notConfigured")}
                </p>
              ) : messages.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-sm">{t("intro")}</p>
                  <h3 className="text-sm font-semibold">{t("starters.title")}</h3>
                  <ul className="space-y-2">
                    {ASSISTANT_STARTERS.map((key) => (
                      <li key={key}>
                        <Button
                          variant="outline"
                          className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                          onClick={() => void ask(t(`starters.${key}`))}
                          disabled={busy || !status}
                          data-testid="assistant-starter"
                        >
                          {t(`starters.${key}`)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ol className="space-y-4" aria-label={t("conversation")}>
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <li key={m.id} className="flex justify-end">
                        <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                          <span className="sr-only">{t("you")}: </span>
                          {m.content}
                        </div>
                      </li>
                    ) : (
                      <li
                        key={m.id}
                        className="space-y-2"
                        aria-busy={m.state === "streaming"}
                        data-testid="assistant-answer"
                        data-state={m.state}
                      >
                        <span className="sr-only">{t("title")}: </span>
                        {m.tools.length ? (
                          <ul className="flex flex-wrap gap-1.5" aria-label={t("tool.label")}>
                            {m.tools.map((c) => (
                              <li
                                key={c.callId}
                                className={cn(
                                  "bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                                  !c.ok && "text-destructive",
                                )}
                                data-testid="assistant-tool"
                              >
                                {c.done ? (
                                  <Check className="size-3" aria-hidden />
                                ) : (
                                  <Loader2 className="size-3 animate-spin" aria-hidden />
                                )}
                                {!c.done
                                  ? t(`tool.running.${c.name}`)
                                  : c.ok
                                    ? t(`tool.done.${c.name}`, { count: c.count })
                                    : t("tool.failed")}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {m.content ? <MarkdownLite text={m.content} refs={m.refs} /> : null}
                        {m.state === "streaming" && !m.content ? (
                          <p className="text-muted-foreground flex items-center gap-2 text-sm">
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            {t("thinking")}
                          </p>
                        ) : null}
                        {m.state === "error" ? (
                          <p className="text-destructive text-sm" data-testid="assistant-error">
                            {t(`error.${m.error ?? "failed"}`)}
                          </p>
                        ) : null}
                        {m.state === "done" && m.content ? (
                          <p className="text-muted-foreground text-xs">{t("aiLabel")}</p>
                        ) : null}
                      </li>
                    ),
                  )}
                </ol>
              )}
              <div ref={endRef} />
            </div>
            <form
              className="flex items-end gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
            >
              <label htmlFor="assistant-input" className="sr-only">
                {t("inputLabel")}
              </label>
              <Textarea
                id="assistant-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                placeholder={t("placeholder")}
                maxLength={2000}
                rows={1}
                className="max-h-40 min-h-10 resize-none"
                disabled={unavailable !== undefined}
                data-testid="assistant-input"
              />
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={stop}
                  aria-label={t("stop")}
                  title={t("stop")}
                >
                  <Square />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  aria-label={t("send")}
                  title={t("send")}
                  disabled={!input.trim() || unavailable !== undefined}
                  data-testid="assistant-send"
                >
                  <Send />
                </Button>
              )}
            </form>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
