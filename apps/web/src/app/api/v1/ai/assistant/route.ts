import { assistant, RateLimitedError, type RateLimitStatus } from "@fieldops/core";
import type { AssistantStreamEvent } from "@fieldops/shared";
import { authenticate, problemResponse } from "@/server/api/handler";
import { resolveLocale } from "@/server/locale";
import { ApiProblem, internalProblem, problemFromError } from "@/server/api/problem";
import { aiGuard, assistantModel, txRunner } from "@/server/ai";
import { logger } from "@/server/logger";
import { metaFromHeaders } from "@/server/request-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/ai/assistant (AI-02): asks Ask FieldOps a question and streams the answer as server-sent events.
// Not wrapped in apiRoute(): that holds one transaction for the whole request. Here the checks and the question are
// one short transaction before the stream opens (so limits and errors are ordinary problem responses), each tool
// call opens its own while the model streams, and the answer is saved in a last one.

function rateLimitHeaders(s: RateLimitStatus | null, now = Date.now()): Record<string, string> {
  if (!s) return {};
  return {
    "RateLimit-Limit": String(s.limit),
    "RateLimit-Remaining": String(Math.max(0, s.remaining)),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((s.resetAt.getTime() - now) / 1000))),
  };
}

export async function POST(req: Request): Promise<Response> {
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[\w.-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  const path = new URL(req.url).pathname;
  const log = logger.child({ requestId, method: "POST", path });
  let prepared;
  try {
    const actor = await authenticate(req);
    if (!/^application\/([\w.+-]*\+)?json\b/i.test(req.headers.get("content-type") ?? "")) {
      throw new ApiProblem(415, "unsupported_media_type", "Send JSON with `Content-Type: application/json`");
    }
    const body: unknown = await req.json().catch(() => {
      throw new ApiProblem(400, "bad_request", "The request body is not valid JSON");
    });
    const run = txRunner(actor);
    const session = await assistant.startAsk(
      run,
      assistantModel,
      body,
      await aiGuard(metaFromHeaders(req.headers).ip),
      // Answers follow the question's language, else the user's app language (SET-05).
      await resolveLocale(),
    );
    prepared = { actor, run, session };
  } catch (err) {
    const problem = problemFromError(err, path);
    if (problem) {
      const headers =
        err instanceof RateLimitedError
          ? {
              "Retry-After": String(
                Math.max(1, Math.ceil((err.limit.resetAt.getTime() - Date.now()) / 1000)),
              ),
              ...rateLimitHeaders({ limit: err.limit.limit, remaining: 0, resetAt: err.limit.resetAt }),
            }
          : problem.headers;
      if (problem.body.status >= 500 && problem.body.status !== 503) log.error({ err }, "assistant failed");
      return problemResponse(problem.body, requestId, headers);
    }
    log.error({ err }, "assistant failed");
    return problemResponse(internalProblem(path), requestId);
  }

  const { actor, run, session } = prepared;
  const encoder = new TextEncoder();
  // Closing the panel or the connection stops the model; the call is still logged.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: AssistantStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        const result = await assistant.streamAnswer(run, assistantModel, session, send, {
          signal: abort.signal,
          onToolError: (err) => log.error({ err }, "assistant tool failed"),
        });
        log.info(
          {
            ok: result.ok,
            orgId: actor.organizationId,
            userId: actor.userId,
            provider: assistantModel.provider,
          },
          "assistant answer",
        );
      } catch (err) {
        log.error({ err }, "assistant answer failed");
        send({
          type: "error",
          code: "failed",
          message: "The assistant couldn't answer. Try again in a moment.",
        });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
      ...rateLimitHeaders(session.rateLimit),
    },
  });
}
