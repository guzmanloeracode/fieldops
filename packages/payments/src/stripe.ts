import type { CheckoutRequest, CheckoutSession, ConfirmedPayment, PaymentProvider } from "@fieldops/core";
import { CURRENCIES, type Currency } from "@fieldops/shared";
import Stripe from "stripe";

// Stripe Checkout (FIN-05): a hosted payment page in payment mode for the invoice's balance, and the webhook that
// confirms it. FieldOps amounts are ISO minor units, the same unit Stripe expects for USD and IDR (both have two
// decimals in ISO 4217 and in Stripe). The organization and invoice travel in the session's metadata, so the
// webhook can find the tenant without a lookup table.

/** The part of the Stripe client the provider uses; tests pass a fake, so nothing calls the network. */
export interface StripeCheckoutClient {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: { idempotencyKey?: string },
      ): Promise<Pick<Stripe.Checkout.Session, "id" | "url" | "expires_at">>;
    };
  };
}

export interface StripeOptions {
  secretKey: string;
  client?: StripeCheckoutClient;
}

export function stripeClient(secretKey: string): StripeCheckoutClient {
  return new Stripe(secretKey, {
    appInfo: { name: "FieldOps", url: "https://github.com/guzmanloeracode/fieldops" },
    maxNetworkRetries: 2,
    timeout: 15_000,
  });
}

/** The Checkout Session parameters for a request (exported for tests). */
export function sessionParams(req: CheckoutRequest): Stripe.Checkout.SessionCreateParams {
  const metadata = { organization_id: req.organizationId, invoice_id: req.invoiceId };
  return {
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: req.currency.toLowerCase(),
          unit_amount: req.amountMinor,
          product_data: { name: `Invoice ${req.invoiceNumber}`, description: req.organizationName },
        },
      },
    ],
    client_reference_id: req.invoiceId,
    metadata,
    payment_intent_data: {
      metadata,
      description: `${req.organizationName} invoice ${req.invoiceNumber}`,
    },
    ...(req.customerEmail ? { customer_email: req.customerEmail } : {}),
    locale: req.locale === "id" ? "id" : "en",
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
  };
}

const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;

export function stripeProvider(opts: StripeOptions): PaymentProvider {
  const client = opts.client ?? stripeClient(opts.secretKey);
  return {
    name: "stripe",
    async createCheckout(req: CheckoutRequest, now: Date): Promise<CheckoutSession> {
      // Two requests racing for the same invoice and amount get one session. The key changes every ten minutes,
      // so a session that is about to expire is never handed out again.
      const window = Math.floor(now.getTime() / IDEMPOTENCY_WINDOW_MS);
      const session = await client.checkout.sessions.create(sessionParams(req), {
        idempotencyKey: `fieldops-checkout-${req.invoiceId}-${req.amountMinor}-${req.currency}-${window}`,
      });
      if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
      return { sessionId: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000) };
    },
  };
}

// ------------------------------------------------------------------ webhook

/** The webhook's signature or payload didn't verify: answer 400 and record nothing. */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export type StripeWebhookResult =
  | { kind: "payment"; eventId: string; payment: ConfirmedPayment }
  | { kind: "ignored"; eventId: string; type: string; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/**
 * Verifies a webhook delivery with the endpoint's signing secret (`Stripe-Signature`, 5-minute tolerance) and
 * turns a paid Checkout Session into a confirmed payment: the payment intent is the provider reference, so a
 * repeated delivery records nothing new. Other events, unpaid sessions (an async method still pending) and
 * sessions FieldOps didn't create are ignored.
 */
export function parseStripeWebhook(
  payload: string,
  signature: string | null,
  secret: string,
  now: Date = new Date(),
): StripeWebhookResult {
  if (!signature) throw new WebhookSignatureError("Missing Stripe-Signature header");
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(
      payload,
      signature,
      secret,
      Stripe.webhooks.DEFAULT_TOLERANCE,
      undefined,
      now.getTime(),
    );
  } catch (err) {
    throw new WebhookSignatureError(err instanceof Error ? err.message : "Invalid webhook");
  }
  const ignore = (reason: string): StripeWebhookResult => ({
    kind: "ignored",
    eventId: event.id,
    type: event.type,
    reason,
  });
  if (!PAID_EVENTS.has(event.type)) return ignore("event type not handled");
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") return ignore("not paid yet");
  const orgId = session.metadata?.organization_id;
  const invoiceId = session.metadata?.invoice_id;
  if (!orgId || !invoiceId || !UUID.test(orgId) || !UUID.test(invoiceId)) {
    return ignore("not a FieldOps invoice");
  }
  const intent =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const currency = session.currency?.toUpperCase() as Currency | undefined;
  if (!intent || session.amount_total === null || !currency || !CURRENCIES.includes(currency)) {
    return ignore("missing payment details");
  }
  return {
    kind: "payment",
    eventId: event.id,
    payment: {
      provider: "stripe",
      providerRef: intent,
      sessionId: session.id,
      organizationId: orgId,
      invoiceId,
      amountMinor: session.amount_total,
      currency,
      paidAt: new Date(event.created * 1000),
    },
  };
}

/** Signs a payload the way Stripe does (tests and local tooling). */
export function signStripePayload(payload: string, secret: string, now: Date = new Date()): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(now.getTime() / 1000),
  });
}
