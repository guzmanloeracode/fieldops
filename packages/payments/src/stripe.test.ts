import { readFileSync } from "node:fs";
import type { CheckoutRequest } from "@fieldops/core";
import { describe, expect, it, vi } from "vitest";
import {
  parseStripeWebhook,
  sessionParams,
  signStripePayload,
  stripeClient,
  stripeProvider,
  WebhookSignatureError,
  type StripeCheckoutClient,
} from "./stripe";

// Stripe Checkout and its webhook, offline: a fake client for sessions, and a recorded event signed with a test
// secret for the webhook. Nothing here calls the network.

const SECRET = "whsec_test_fieldops_fixture_secret";
const FIXTURE = readFileSync(new URL("./fixtures/checkout-session-completed.json", import.meta.url), "utf8");
const EVENT_AT = new Date(1794326400 * 1000);
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INVOICE = "7b1e2c4a-3f5d-4e6a-9b8c-0d1e2f3a4b5c";

function withSession(patch: Record<string, unknown>, type?: string): string {
  const event = JSON.parse(FIXTURE) as { type: string; data: { object: Record<string, unknown> } };
  Object.assign(event.data.object, patch);
  if (type) event.type = type;
  return JSON.stringify(event);
}

const request: CheckoutRequest = {
  organizationId: ORG,
  organizationName: "Acme Air & Clean",
  invoiceId: INVOICE,
  invoiceNumber: "INV-2026-0042",
  customerEmail: "jamie.rivera@example.com",
  amountMinor: 27063,
  currency: "USD",
  locale: "en",
  successUrl: "https://fieldops.example/portal/acme-air/invoices/x?payment=success",
  cancelUrl: "https://fieldops.example/portal/acme-air/invoices/x?payment=canceled",
};

describe("Stripe webhook", () => {
  it("verifies the signature of a recorded event and confirms the payment", () => {
    const header = signStripePayload(FIXTURE, SECRET, EVENT_AT);
    const r = parseStripeWebhook(FIXTURE, header, SECRET, new Date(EVENT_AT.getTime() + 30_000));
    expect(r).toEqual({
      kind: "payment",
      eventId: "evt_1QfoTestCheckoutCompleted",
      payment: {
        provider: "stripe",
        providerRef: "pi_3QfoTestFieldOps0042",
        sessionId: "cs_test_a1FieldOpsInvoice0042",
        organizationId: ORG,
        invoiceId: INVOICE,
        amountMinor: 27063,
        currency: "USD",
        paidAt: EVENT_AT,
      },
    });
  });

  it("rejects a missing header, another secret, a changed body and an old signature", () => {
    const header = signStripePayload(FIXTURE, SECRET, EVENT_AT);
    expect(() => parseStripeWebhook(FIXTURE, null, SECRET, EVENT_AT)).toThrow(WebhookSignatureError);
    expect(() => parseStripeWebhook(FIXTURE, header, "whsec_other", EVENT_AT)).toThrow(WebhookSignatureError);
    const tampered = FIXTURE.replace('"amount_total": 27063', '"amount_total": 1');
    expect(() => parseStripeWebhook(tampered, header, SECRET, EVENT_AT)).toThrow(WebhookSignatureError);
    const late = new Date(EVENT_AT.getTime() + 10 * 60_000);
    expect(() => parseStripeWebhook(FIXTURE, header, SECRET, late)).toThrow(/timestamp/i);
    expect(() => parseStripeWebhook(FIXTURE, "t=1,v1=nonsense", SECRET, EVENT_AT)).toThrow(
      WebhookSignatureError,
    );
  });

  it("also confirms an async payment that succeeded, with an expanded payment intent", () => {
    const body = withSession(
      { payment_intent: { id: "pi_async_1", object: "payment_intent" } },
      "checkout.session.async_payment_succeeded",
    );
    const r = parseStripeWebhook(body, signStripePayload(body, SECRET, EVENT_AT), SECRET, EVENT_AT);
    expect(r.kind === "payment" && r.payment.providerRef).toBe("pi_async_1");
  });

  it("ignores other events, unpaid sessions and sessions it didn't create", () => {
    const cases: [string, string][] = [
      [withSession({}, "checkout.session.expired"), "event type not handled"],
      [withSession({ payment_status: "unpaid" }), "not paid yet"],
      [withSession({ metadata: {} }), "not a FieldOps invoice"],
      [withSession({ metadata: { organization_id: "acme", invoice_id: INVOICE } }), "not a FieldOps invoice"],
      [withSession({ metadata: null }), "not a FieldOps invoice"],
      [withSession({ payment_intent: null }), "missing payment details"],
      [withSession({ amount_total: null }), "missing payment details"],
      [withSession({ currency: "eur" }), "missing payment details"],
      [withSession({ currency: null }), "missing payment details"],
    ];
    for (const [body, reason] of cases) {
      const r = parseStripeWebhook(body, signStripePayload(body, SECRET, EVENT_AT), SECRET, EVENT_AT);
      expect(r).toMatchObject({ kind: "ignored", eventId: "evt_1QfoTestCheckoutCompleted", reason });
    }
  });
});

describe("Stripe Checkout sessions", () => {
  it("asks for one payment of the balance, with the tenant in the metadata", () => {
    const p = sessionParams(request);
    expect(p).toMatchObject({
      mode: "payment",
      client_reference_id: INVOICE,
      metadata: { organization_id: ORG, invoice_id: INVOICE },
      payment_intent_data: { metadata: { organization_id: ORG, invoice_id: INVOICE } },
      customer_email: "jamie.rivera@example.com",
      locale: "en",
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    expect(p.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 27063,
          product_data: { name: "Invoice INV-2026-0042", description: "Acme Air & Clean" },
        },
      },
    ]);
    const id = sessionParams({ ...request, locale: "id", currency: "IDR", customerEmail: null });
    expect(id.locale).toBe("id");
    expect(id.line_items![0]!.price_data!.currency).toBe("idr");
    expect(id).not.toHaveProperty("customer_email");
  });

  it("creates a session through the client with an idempotency key per invoice, amount and ten minutes", async () => {
    const create = vi.fn(async () => ({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expires_at: 1794412800,
    }));
    const client = { checkout: { sessions: { create } } } as unknown as StripeCheckoutClient;
    const provider = stripeProvider({ secretKey: "sk_test_x", client });
    expect(provider.name).toBe("stripe");
    const session = await provider.createCheckout(request, EVENT_AT);
    expect(session).toEqual({
      sessionId: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expiresAt: new Date(1794412800 * 1000),
    });
    const key = (create.mock.calls[0] as unknown[])[1] as { idempotencyKey: string };
    expect(key.idempotencyKey).toBe(
      `fieldops-checkout-${INVOICE}-27063-USD-${Math.floor(EVENT_AT.getTime() / 600_000)}`,
    );

    create.mockResolvedValueOnce({ id: "cs_test_2", url: null as unknown as string, expires_at: 1 });
    await expect(provider.createCheckout(request, EVENT_AT)).rejects.toThrow(/without a URL/);
  });

  it("builds a real client from the secret key without calling Stripe", () => {
    const client = stripeClient("sk_test_offline");
    expect(typeof client.checkout.sessions.create).toBe("function");
    expect(stripeProvider({ secretKey: "sk_test_offline" }).name).toBe("stripe");
  });
});
