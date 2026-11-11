import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
  ValidationError,
} from "../domain/errors";
import { billingWorld, type BillingWorld } from "../test/billing-world";
import * as invoices from "./invoices";
import * as payments from "./payments";
import type { CheckoutDeps, CheckoutRequest, OnlineProvider, PaymentProvider } from "./payments-types";
import type { PortalActor } from "./portal-types";

// Online payments (FIN-05): checkout sessions reused until they expire, payments confirmed once per provider
// reference, and the simulated checkout.

const APP = "https://app.example";
const HOUR = 3_600_000;

function fakeProvider(name: OnlineProvider = "simulated", ttl = HOUR) {
  const calls: CheckoutRequest[] = [];
  let before: (() => void) | null = null;
  const provider: PaymentProvider = {
    name,
    async createCheckout(req, now) {
      calls.push(req);
      before?.();
      const n = calls.length;
      return {
        sessionId: `${name === "simulated" ? "sim_" : "cs_test_"}session${n}`,
        url: `https://pay.example/${n}`,
        expiresAt: new Date(now.getTime() + ttl),
      };
    },
  };
  return { provider, calls, beforeReturn: (fn: () => void) => (before = fn) };
}

function deps(w: BillingWorld, provider: PaymentProvider | null, now = new Date()): CheckoutDeps {
  return { provider, appUrl: APP, now, run: (fn) => fn(w.store) };
}

const payDeps = (w: BillingWorld, now = new Date()) => ({
  store: w.store,
  now,
  mailer: w.mailer,
  customerMailer: w.customerMailer,
});

async function issued(w: BillingWorld, price = 10_000) {
  const draft = await invoices.createInvoice(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    contact_id: w.caraContactId,
    lines: [
      { kind: "fee", description: "Call-out fee", quantity: 1, unit_price_minor: price, tax_rate_bps: 0 },
    ],
  });
  return invoices.sendInvoice(w.bctx(w.dispatcher), draft.id);
}

function portalActor(w: BillingWorld, customerId = w.customerId): PortalActor {
  return {
    organizationId: w.store.organizationId,
    customerId,
    customerName: "Cara Customer",
    contactId: w.caraContactId,
    contactName: "Cara Customer",
  };
}

describe("checkout sessions", () => {
  it("asks the provider for the balance, coming back to the portal invoice, and stores the session", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    await invoices.recordPayment(w.bctx(w.dispatcher), inv.id, { amount_minor: 2500, method: "cash" });
    const { provider, calls } = fakeProvider();
    const link = await payments.checkoutForInvoice(deps(w, provider), w.dispatcher, inv.id);
    expect(link).toMatchObject({ provider: "simulated", reused: false, sessionId: "sim_session1" });
    expect(calls).toEqual([
      {
        organizationId: w.store.organizationId,
        organizationName: w.data.org.name,
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        customerEmail: "cara@example.com",
        amountMinor: 7500,
        currency: "USD",
        locale: "en",
        successUrl: `${APP}/portal/${w.data.org.slug}/invoices/${inv.id}?payment=success`,
        cancelUrl: `${APP}/portal/${w.data.org.slug}/invoices/${inv.id}?payment=canceled`,
      },
    ]);
    expect(await w.store.billing.getCheckout(inv.id)).toEqual({
      sessionId: link.sessionId,
      url: link.url,
      expiresAt: link.expiresAt,
    });
  });

  it("reuses the open session until it is about to expire, and never another provider's", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    const { provider, calls } = fakeProvider();
    const now = new Date();
    const first = await payments.checkoutForInvoice(deps(w, provider, now), w.owner, inv.id);
    const again = await payments.checkoutForPortal(deps(w, provider, now), portalActor(w), inv.id);
    expect(again).toMatchObject({ sessionId: first.sessionId, url: first.url, reused: true });
    expect(calls).toHaveLength(1);

    // Less than ten minutes left: a new session.
    const late = new Date(now.getTime() + HOUR - 5 * 60_000);
    const renewed = await payments.checkoutForInvoice(deps(w, provider, late), w.owner, inv.id);
    expect(renewed).toMatchObject({ sessionId: "sim_session2", reused: false });

    // Switching to Stripe never hands out the simulated session.
    const stripe = fakeProvider("stripe");
    const s = await payments.checkoutForInvoice(deps(w, stripe.provider, late), w.owner, inv.id);
    expect(s).toMatchObject({ provider: "stripe", sessionId: "cs_test_session1", reused: false });
  });

  it("drops the session when any payment changes the balance", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    const { provider, calls } = fakeProvider();
    await payments.checkoutForInvoice(deps(w, provider), w.owner, inv.id);
    await invoices.recordPayment(w.bctx(w.dispatcher), inv.id, { amount_minor: 1000, method: "cash" });
    expect(await w.store.billing.getCheckout(inv.id)).toBeNull();
    await payments.checkoutForInvoice(deps(w, provider), w.owner, inv.id);
    expect(calls.map((c) => c.amountMinor)).toEqual([10_000, 9000]);
  });

  it("needs billing access, an open invoice with a balance, and a provider", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    const { provider } = fakeProvider();
    await expect(payments.checkoutForInvoice(deps(w, provider), w.tom, inv.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(payments.checkoutForInvoice(deps(w, null), w.owner, inv.id)).rejects.toBeInstanceOf(
      UnavailableError,
    );
    await expect(payments.checkoutForInvoice(deps(w, provider), w.owner, "INV-1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      payments.checkoutForInvoice(deps(w, provider), w.owner, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);

    const draft = await invoices.createInvoice(w.ctx(w.dispatcher), { customer_id: w.customerId, lines: [] });
    await expect(payments.checkoutForInvoice(deps(w, provider), w.owner, draft.id)).rejects.toThrow(
      "A draft invoice can't be paid online",
    );
    await invoices.recordPayment(w.bctx(w.dispatcher), inv.id, { amount_minor: 10_000, method: "cash" });
    await expect(payments.checkoutForInvoice(deps(w, provider), w.owner, inv.id)).rejects.toThrow(
      "This invoice is already paid",
    );
  });

  it("reports a conflict when the invoice closed while the provider was asked", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    const fake = fakeProvider();
    fake.beforeReturn(() => {
      w.billing().invoices.find((i) => i.id === inv.id)!.status = "void";
    });
    await expect(payments.checkoutForInvoice(deps(w, fake.provider), w.owner, inv.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("lets a portal customer pay only their own invoices", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    const { provider } = fakeProvider();
    await expect(
      payments.checkoutForPortal(deps(w, provider), portalActor(w, w.otherCustomerId), inv.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    const link = await payments.checkoutForPortal(deps(w, provider), portalActor(w), inv.id);
    expect(link.reused).toBe(false);
  });

  it("knows a session's provider by its id", () => {
    expect(payments.sessionProvider("sim_abc")).toBe("simulated");
    expect(payments.sessionProvider("cs_test_abc")).toBe("stripe");
  });
});

describe("confirmed payments", () => {
  const confirmed = (w: BillingWorld, invoiceId: string, over: Record<string, unknown> = {}) => ({
    provider: "stripe" as const,
    providerRef: "pi_1",
    sessionId: "cs_test_1",
    organizationId: w.store.organizationId,
    invoiceId,
    amountMinor: 10_000,
    currency: "USD" as const,
    paidAt: new Date("2026-11-10T16:00:00Z"),
    ...over,
  });

  it("records a card payment by the provider once, however often the event arrives", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    const first = await payments.confirmOnlinePayment(payDeps(w), confirmed(w, inv.id));
    expect(first.outcome).toBe("recorded");
    expect(first.invoice.status).toBe("paid");
    expect(first.invoice.payments).toMatchObject([
      { amountMinor: 10_000, method: "card", provider: "stripe", providerRef: "pi_1", recordedBy: null },
    ]);
    const again = await payments.confirmOnlinePayment(payDeps(w), confirmed(w, inv.id));
    expect(again.outcome).toBe("duplicate");
    expect(w.billing().payments).toHaveLength(1);

    // Owners hear about it, without a "recorded by"; the customer gets one receipt.
    const note = w.notifications().filter((n) => n.type === "payment_received");
    expect(note.map((n) => n.userId)).toEqual([w.owner.userId]);
    expect(note[0]!.payload).not.toHaveProperty("actor_name");
    expect(w.emails.filter((e) => e.kind === "payment_receipt")).toHaveLength(1);
  });

  it("refuses another currency, an unknown invoice and more than the balance", async () => {
    const w = billingWorld();
    const inv = await issued(w);
    await expect(
      payments.confirmOnlinePayment(payDeps(w), confirmed(w, inv.id, { currency: "IDR" })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      payments.confirmOnlinePayment(payDeps(w), confirmed(w, crypto.randomUUID())),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(payments.confirmOnlinePayment(payDeps(w), confirmed(w, "nope"))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      payments.confirmOnlinePayment(payDeps(w), confirmed(w, inv.id, { amountMinor: 10_001 })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(w.billing().payments).toHaveLength(0);
  });
});

describe("simulated checkout", () => {
  async function opened(w: BillingWorld, now = new Date()) {
    const inv = await issued(w);
    const { provider } = fakeProvider();
    const link = await payments.checkoutForPortal(deps(w, provider, now), portalActor(w), inv.id);
    return { inv, link, claim: { invoiceId: inv.id, sessionId: link.sessionId } };
  }

  it("shows the open session, pays the balance once and then shows it paid", async () => {
    const w = billingWorld();
    const { inv, claim } = await opened(w);
    const view = await payments.testCheckout(w.store, new Date(), claim);
    expect(view).toEqual({
      state: "open",
      organizationName: w.data.org.name,
      invoiceNumber: inv.number,
      amountMinor: 10_000,
      currency: "USD",
      returnPath: `/portal/${w.data.org.slug}/invoices/${inv.id}`,
    });

    const paid = await payments.payTestCheckout(payDeps(w), claim);
    expect(paid.outcome).toBe("recorded");
    expect(paid.invoice.status).toBe("paid");
    expect(paid.invoice.payments[0]).toMatchObject({
      provider: "simulated",
      providerRef: claim.sessionId,
      method: "card",
    });
    expect((await payments.payTestCheckout(payDeps(w), claim)).outcome).toBe("duplicate");
    expect(w.billing().payments).toHaveLength(1);
    expect(await payments.testCheckout(w.store, new Date(), claim)).toMatchObject({
      state: "paid",
      amountMinor: 10_000,
    });
  });

  it("refuses an expired session or one that isn't the invoice's open one", async () => {
    const w = billingWorld();
    const { claim } = await opened(w);
    const later = new Date(Date.now() + 2 * HOUR);
    expect((await payments.testCheckout(w.store, later, claim)).state).toBe("expired");
    await expect(payments.payTestCheckout(payDeps(w, later), claim)).rejects.toThrow(
      "This checkout has expired",
    );
    const other = { ...claim, sessionId: "sim_someoneelse" };
    expect((await payments.testCheckout(w.store, new Date(), other)).state).toBe("expired");
    await expect(payments.payTestCheckout(payDeps(w), other)).rejects.toBeInstanceOf(ConflictError);
    expect(w.billing().payments).toHaveLength(0);
  });

  it("shows a voided invoice's session as expired, and knows no drafts or unknown invoices", async () => {
    const w = billingWorld();
    const { inv, claim } = await opened(w);
    await invoices.voidInvoice(w.ctx(w.owner), inv.id, { reason: "Wrong customer" });
    expect((await payments.testCheckout(w.store, new Date(), claim)).state).toBe("expired");
    const draft = await invoices.createInvoice(w.ctx(w.dispatcher), { customer_id: w.customerId, lines: [] });
    await expect(
      payments.testCheckout(w.store, new Date(), { invoiceId: draft.id, sessionId: "sim_x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      payments.testCheckout(w.store, new Date(), { invoiceId: "x", sessionId: "sim_x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      payments.payTestCheckout(payDeps(w), { invoiceId: crypto.randomUUID(), sessionId: "sim_x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
