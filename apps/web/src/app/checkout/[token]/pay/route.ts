import { DomainError, payments, portalPath } from "@fieldops/core";
import { env } from "@/env";
import { logger } from "@/server/logger";
import { inOrganization } from "@/server/payments";
import { metaFromHeaders } from "@/server/request-meta";
import { testCheckoutClaim } from "../load";

// POST /checkout/<token>/pay: "Pay (test)" on the simulated checkout (FIN-05). Records the balance as a card
// payment by the simulated provider, the way the Stripe webhook does, then answers 303 to the invoice in the
// customer portal, like a hosted checkout's success URL. A plain form post and a real redirect, so the browser
// sends the portal's path-scoped session cookie when it opens the invoice. A session that expired or was replaced
// goes back to the checkout page, which says so.

const sameSite = (req: Request) => {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = new URL(origin).host;
  return host === new URL(env.APP_URL).host || host === req.headers.get("host");
};

export async function POST(req: Request, route: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await route.params;
  if (!sameSite(req)) return new Response("Forbidden", { status: 403 });
  const claim = testCheckoutClaim(token);
  if (!claim) return new Response("Not found", { status: 404 });
  let back: string | null = null;
  try {
    back = await inOrganization(claim.organizationId, metaFromHeaders(req.headers), async (deps) => {
      const r = await payments.payTestCheckout(deps, claim);
      logger.info(
        { orgId: claim.organizationId, invoiceId: claim.invoiceId, outcome: r.outcome },
        "test checkout paid",
      );
      return portalPath(await deps.store.organization.get(), "invoices", claim.invoiceId);
    });
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    logger.info(
      { orgId: claim.organizationId, invoiceId: claim.invoiceId, code: err.code },
      "test checkout refused",
    );
  }
  const to = back ? `${back}?payment=success` : `/checkout/${token}`;
  return new Response(null, { status: 303, headers: { Location: new URL(to, env.APP_URL).toString() } });
}
