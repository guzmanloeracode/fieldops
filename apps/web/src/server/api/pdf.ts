import "server-only";
import type { ServiceContext } from "@fieldops/core";
import { withStore } from "@fieldops/db";
import { env } from "@/env";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { auditMeta, metaFromHeaders } from "@/server/request-meta";
import { authenticate, problemResponse } from "./handler";
import { internalProblem, problemFromError } from "./problem";

type RouteContext<P> = { params: Promise<P> };

/**
 * A /api/v1 route that answers with a PDF (FIN-04): authentication and errors like `apiRoute`. The view model is
 * built inside the tenant transaction; the PDF is rendered after it, so no transaction waits on the renderer.
 */
export function apiPdfRoute<P extends Record<string, string>>(
  load: (args: {
    params: P;
    ctx: ServiceContext;
  }) => Promise<() => Promise<{ bytes: Uint8Array; fileName: string }>>,
) {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const url = new URL(req.url);
    try {
      const actor = await authenticate(req);
      const params = await route.params;
      const render = await withStore(
        db,
        actor.organizationId,
        (store) => load({ params, ctx: { actor, store, now: new Date(), demo: env.DEMO_MODE } }),
        { userId: actor.userId, ...auditMeta(metaFromHeaders(req.headers)) },
      );
      const pdf = await render();
      return new Response(new Blob([pdf.bytes as BlobPart], { type: "application/pdf" }), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdf.fileName}"`,
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
        },
      });
    } catch (err) {
      const problem = problemFromError(err, url.pathname);
      if (problem) return problemResponse(problem.body, requestId, problem.headers);
      logger.error({ err, requestId, path: url.pathname }, "pdf request failed");
      return problemResponse(internalProblem(url.pathname), requestId);
    }
  };
}
