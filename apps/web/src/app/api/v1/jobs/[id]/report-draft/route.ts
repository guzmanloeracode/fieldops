import { RateLimitedError, reports } from "@fieldops/core";
import { authenticate, problemResponse, rateLimitHeaders, tighterLimit } from "@/server/api/handler";
import { internalProblem, problemFromError } from "@/server/api/problem";
import { reportEtag, toReportDto } from "@/server/api/serialize-reports";
import { aiGuard, txRunner } from "@/server/ai";
import { logger } from "@/server/logger";
import { loadReportPhotos } from "@/server/reports/files";
import { reportModel } from "@/server/reports/service";
import { metaFromHeaders } from "@/server/request-meta";

// POST /api/v1/jobs/{id}/report-draft (AI-03, §17.2): drafts the job's service report with AI now and replaces its
// text. Not wrapped in apiRoute(): a model call must not hold a database connection, so the service runs one short
// transaction before the call and one after. Counts against the monthly quota and the AI rate limits.

export async function POST(req: Request, route: { params: Promise<{ id: string }> }): Promise<Response> {
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[\w.-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  const path = new URL(req.url).pathname;
  const log = logger.child({ requestId, method: "POST", path });
  try {
    const actor = await authenticate(req);
    const { id } = await route.params;
    const result = await reports.draftReport(
      txRunner(actor),
      reportModel,
      id,
      await aiGuard(metaFromHeaders(req.headers).ip),
      loadReportPhotos,
    );
    log.info({ status: result.status, orgId: actor.organizationId, userId: actor.userId }, "report draft");
    return new Response(
      JSON.stringify({ status: result.status, model: result.model, report: toReportDto(result.report) }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ETag: reportEtag(result.report.version),
          ...rateLimitHeaders(tighterLimit(result.rateLimit, actor.rateLimit)),
        },
      },
    );
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
      if (problem.body.status >= 500 && problem.body.status !== 503)
        log.error({ err }, "report draft failed");
      return problemResponse(problem.body, requestId, headers);
    }
    log.error({ err }, "report draft failed");
    return problemResponse(internalProblem(path), requestId);
  }
}
