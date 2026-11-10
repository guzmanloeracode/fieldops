import type { CheckoutLink } from "@fieldops/core";
import type { CheckoutSessionDto } from "@fieldops/shared";
import { authenticate, problemResponse } from "@/server/api/handler";
import { internalProblem, problemFromError } from "@/server/api/problem";
import { logger } from "@/server/logger";
import { staffCheckout } from "@/server/payments";

// POST /api/v1/invoices/{id}/checkout (FIN-05): a link that pays the invoice's balance online. Not wrapped in
// apiRoute's single transaction: the provider is called between two short ones, so no transaction waits on it.
// Repeating the call returns the open session (200) instead of creating another (201).

export const dynamic = "force-dynamic";

const toDto = (l: CheckoutLink): CheckoutSessionDto => ({
  id: l.sessionId,
  url: l.url,
  expires_at: l.expiresAt.toISOString(),
  provider: l.provider,
  reused: l.reused,
});

export async function POST(req: Request, route: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = crypto.randomUUID();
  const path = new URL(req.url).pathname;
  try {
    const actor = await authenticate(req);
    const { id } = await route.params;
    const link = await staffCheckout(actor, id);
    logger.info(
      { requestId, orgId: actor.organizationId, invoiceId: id, reused: link.reused },
      "checkout link",
    );
    return Response.json(toDto(link), {
      status: link.reused ? 200 : 201,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (err) {
    const problem = problemFromError(err, path);
    if (problem) return problemResponse(problem.body, requestId, problem.headers);
    logger.error({ err, requestId, path }, "checkout request failed");
    return problemResponse(internalProblem(path), requestId);
  }
}
