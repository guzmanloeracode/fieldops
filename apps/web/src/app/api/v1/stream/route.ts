import { can } from "@fieldops/core";
import { authenticate, problemResponse, rateLimitHeaders } from "@/server/api/handler";
import { problemFromError } from "@/server/api/problem";
import { liveHub, type LiveEvent } from "@/server/live";
import { logger } from "@/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events (NOT-05, SCH-06, ADR 011). Office roles get the organization's board changes (jobs, time
 * off, expenses); everyone gets their own new notifications. Messages carry ids only: clients fetch the data
 * through the usual, permission-checked pages and endpoints.
 */
export async function GET(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  let actor;
  try {
    actor = await authenticate(req);
  } catch (err) {
    const problem = problemFromError(err, "/api/v1/stream");
    if (problem) return problemResponse(problem.body, requestId, problem.headers);
    logger.error({ err }, "stream auth failed");
    throw err;
  }
  const seesBoard = can(actor, "schedule.view");
  const wants = (e: LiveEvent) =>
    e.org === actor.organizationId && (e.kind === "notification" ? e.user === actor.userId : seesBoard);

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      // Reconnect after 3 s; "ready" lets the client refetch what it may have missed while disconnected.
      send(`retry: 3000\nevent: ready\ndata: {}\n\n`);
      const unsubscribe = liveHub.subscribe((e) => {
        if (wants(e)) send(`event: ${e.kind}\ndata: ${JSON.stringify({ kind: e.kind, id: e.id })}\n\n`);
      });
      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        cleanup = () => {};
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
      "X-Request-Id": requestId,
      ...rateLimitHeaders(actor.rateLimit),
    },
  });
}
