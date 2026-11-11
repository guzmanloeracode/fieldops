import { ai, RateLimitedError } from "@fieldops/core";
import type { AiIntakeResponse } from "@fieldops/shared";
import { authenticate, problemResponse, rateLimitHeaders, tighterLimit } from "@/server/api/handler";
import { ApiProblem, internalProblem, problemFromError } from "@/server/api/problem";
import { aiGuard, intakeModel, txRunner } from "@/server/ai";
import { logger } from "@/server/logger";
import { metaFromHeaders } from "@/server/request-meta";

// POST /api/v1/ai/intake (AI-01, PLT-04). Not wrapped in apiRoute(): that holds one transaction for the whole
// request, and a model call must not keep a database connection busy. The service runs one short transaction
// before the call (permissions, quota, rate limits) and one after (validation, logging).

// The response carries the tighter of the AI limit and the API's per-minute limit (PLT-04).

export async function POST(req: Request): Promise<Response> {
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[\w.-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  const path = new URL(req.url).pathname;
  const log = logger.child({ requestId, method: "POST", path });
  try {
    const actor = await authenticate(req);
    if (!/^application\/([\w.+-]*\+)?json\b/i.test(req.headers.get("content-type") ?? "")) {
      throw new ApiProblem(415, "unsupported_media_type", "Send JSON with `Content-Type: application/json`");
    }
    const body: unknown = await req.json().catch(() => {
      throw new ApiProblem(400, "bad_request", "The request body is not valid JSON");
    });
    const result = await ai.draftIntake(
      txRunner(actor),
      intakeModel,
      body,
      await aiGuard(metaFromHeaders(req.headers).ip),
    );
    const out: AiIntakeResponse = {
      status: result.ok ? "drafted" : result.reason,
      interaction_id: result.interactionId,
      draft: result.ok ? result.draft : null,
      customer_suggestions: result.ok ? result.customerSuggestions : [],
      model: result.model,
      quota: result.quota,
    };
    log.info({ status: out.status, orgId: actor.organizationId, userId: actor.userId }, "ai intake");
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        ...rateLimitHeaders(tighterLimit(result.rateLimit, actor.rateLimit)),
      },
    });
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
      if (problem.body.status >= 500 && problem.body.status !== 503) log.error({ err }, "ai intake failed");
      return problemResponse(problem.body, requestId, headers);
    }
    log.error({ err }, "ai intake failed");
    return problemResponse(internalProblem(path), requestId);
  }
}
