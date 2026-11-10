import { DomainError, payments } from "@fieldops/core";
import { parseStripeWebhook, WebhookSignatureError } from "@fieldops/payments";
import { logger } from "@/server/logger";
import { inOrganization, stripeWebhookSecret } from "@/server/payments";
import { metaFromHeaders } from "@/server/request-meta";

// POST /api/webhooks/stripe (FIN-05, internal: not part of the public API). Stripe calls it when a Checkout
// Session is paid. The signature is checked with the endpoint's signing secret before anything is read; the
// payment is then recorded in the invoice's organization, once per payment intent. Answers:
//   200: recorded, already recorded, ignored (another event type), or refused for good (logged for a person);
//   400: bad signature or payload; 404: Stripe isn't the provider; 500: try again (Stripe retries for 3 days).

export const dynamic = "force-dynamic";

const MAX_BODY = 512 * 1024;

const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  const secret = stripeWebhookSecret();
  if (!secret) return reply(404, { error: "not_found" });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return reply(413, { error: "too_large" });
  const payload = await req.text();
  if (payload.length > MAX_BODY) return reply(413, { error: "too_large" });

  let parsed: ReturnType<typeof parseStripeWebhook>;
  try {
    parsed = parseStripeWebhook(payload, req.headers.get("stripe-signature"), secret);
  } catch (err) {
    if (!(err instanceof WebhookSignatureError)) throw err;
    logger.warn({ reason: err.message }, "stripe webhook refused");
    return reply(400, { error: "invalid_signature" });
  }
  if (parsed.kind === "ignored") {
    logger.info(
      { eventId: parsed.eventId, type: parsed.type, reason: parsed.reason },
      "stripe event ignored",
    );
    return reply(200, { received: true, handled: false });
  }

  const p = parsed.payment;
  const log = logger.child({
    eventId: parsed.eventId,
    orgId: p.organizationId,
    invoiceId: p.invoiceId,
    providerRef: p.providerRef,
  });
  const meta = metaFromHeaders(req.headers);
  try {
    const r = await inOrganization(p.organizationId, meta, (deps) => payments.confirmOnlinePayment(deps, p));
    log.info({ outcome: r.outcome, status: r.invoice.status }, "stripe payment confirmed");
    return reply(200, { received: true, outcome: r.outcome });
  } catch (err) {
    if (!(err instanceof DomainError)) {
      log.error({ err }, "stripe webhook failed");
      return reply(500, { error: "internal" });
    }
    // A concurrent delivery of the same event may have recorded it meanwhile.
    const recorded = await inOrganization(p.organizationId, meta, ({ store }) =>
      store.billing.findPayment(p.provider, p.providerRef),
    ).catch(() => null);
    if (recorded) return reply(200, { received: true, outcome: "duplicate" });
    // Retrying won't change the answer (a void or already settled invoice, an amount above the balance): the
    // money needs a person, to refund it or record it by hand.
    log.error({ err }, "stripe payment could not be recorded");
    return reply(200, { received: true, outcome: "rejected", reason: err.code });
  }
}
