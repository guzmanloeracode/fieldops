import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { billingWorld, type BillingWorld } from "../test/billing-world";
import * as invoices from "./invoices";
import * as portalBilling from "./portal-billing";
import type { PortalContext } from "./portal-types";
import * as quotes from "./quotes";

// Quotes and invoices in the customer portal (POR-04): only what was sent to this customer, without internal
// amounts; decisions by the contact; first views recorded.

function portalCtx(w: BillingWorld, customerId = w.customerId, now = new Date()): PortalContext {
  return {
    portal: {
      organizationId: w.store.organizationId,
      customerId,
      customerName: "Cara Customer",
      contactId: w.caraContactId,
      contactName: "Cara",
    },
    store: w.store,
    now,
    demo: false,
    mailer: w.mailer,
  };
}

const line = (price: number) => ({
  kind: "service",
  description: "Coil cleaning",
  quantity: 2,
  unit: "unit",
  unit_price_minor: price,
  tax_rate_bps: 825,
});

async function quote(
  w: BillingWorld,
  opts: { send?: boolean; validUntil?: string; customer?: "other" } = {},
) {
  const other = opts.customer === "other";
  const q = await quotes.createQuote(w.ctx(w.dispatcher), {
    customer_id: other ? w.otherCustomerId : w.customerId,
    site_id: other ? w.otherSiteId : w.siteId,
    contact_id: other ? w.otherContactId : w.caraContactId,
    service_type_id: w.serviceTypeId,
    title: "Coil cleaning",
    notes: "Two units on the roof.",
    ...(opts.validUntil ? { valid_until: opts.validUntil } : {}),
    lines: [line(12_000)],
  });
  return opts.send === false ? q : quotes.sendQuote(w.bctx(w.dispatcher), q.id);
}

async function invoice(w: BillingWorld, opts: { send?: boolean; customer?: "other" } = {}) {
  const other = opts.customer === "other";
  const draft = await invoices.createInvoice(w.ctx(w.dispatcher), {
    customer_id: other ? w.otherCustomerId : w.customerId,
    contact_id: other ? w.otherContactId : w.caraContactId,
    notes: "Thank you!",
    lines: [
      { kind: "fee", description: "Call-out fee", quantity: 1, unit_price_minor: 5000, tax_rate_bps: 0 },
    ],
  });
  return opts.send === false ? draft : invoices.sendInvoice(w.bctx(w.dispatcher), draft.id);
}

describe("portal quotes", () => {
  it("lists only quotes sent to this customer, a stale one as expired", async () => {
    const w = billingWorld();
    const sent = await quote(w);
    await quote(w, { send: false });
    await quote(w, { customer: "other" });
    const stale = await quote(w);
    w.billing().quotes.find((q) => q.id === stale.id)!.validUntil = "2020-01-01";
    const rows = await portalBilling.listPortalQuotes(portalCtx(w));
    expect(rows.map((r) => [r.id, r.status])).toEqual(
      expect.arrayContaining([
        [sent.id, "sent"],
        [stale.id, "expired"],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      number: expect.stringMatching(/^QUO-/),
      title: "Coil cleaning",
      status: expect.any(String),
      currency: "USD",
      totalMinor: sent.totalMinor,
      validUntil: expect.any(String),
      sentAt: expect.any(Date),
      decidedAt: null,
    });
  });

  it("shows a quote's lines and totals, and answers 'not found' for drafts and other customers", async () => {
    const w = billingWorld();
    const sent = await quote(w);
    const q = await portalBilling.getPortalQuote(portalCtx(w), sent.id);
    expect(q).toMatchObject({
      number: sent.number,
      status: "sent",
      canDecide: true,
      notes: "Two units on the roof.",
      site: { label: expect.any(String), line1: expect.any(String), city: expect.any(String) },
      subtotalMinor: 24_000,
      taxMinor: 1980,
      totalMinor: 25_980,
      job: null,
      declineReason: null,
    });
    expect(q.lines.map((l) => [l.description, l.quantity, l.netMinor])).toEqual([
      ["Coil cleaning", 2, 24_000],
    ]);

    const draft = await quote(w, { send: false });
    const theirs = await quote(w, { customer: "other" });
    for (const id of [draft.id, theirs.id, crypto.randomUUID(), "QUO-2026-0001"]) {
      await expect(portalBilling.getPortalQuote(portalCtx(w), id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("records the first view only", async () => {
    const w = billingWorld();
    const sent = await quote(w);
    const first = new Date("2026-11-10T10:00:00Z");
    await portalBilling.markPortalQuoteViewed(portalCtx(w, w.customerId, first), sent.id);
    await portalBilling.markPortalQuoteViewed(portalCtx(w, w.customerId, new Date()), sent.id);
    const row = w.billing().quotes.find((x) => x.id === sent.id)!;
    expect(row.viewedAt).toEqual(first);
    expect(row.version).toBe(sent.version);
  });

  it("approves as the contact: a job is created and the office is told who decided", async () => {
    const w = billingWorld();
    const sent = await quote(w);
    const q = await portalBilling.decidePortalQuote(portalCtx(w), sent.id, { decision: "approve" });
    expect(q).toMatchObject({ status: "approved", canDecide: false, job: { number: expect.any(Number) } });
    const stored = await w.store.billing.getQuote(sent.id);
    expect(stored).toMatchObject({
      decidedByContactId: w.caraContactId,
      decidedByUserId: null,
      decidedByName: "Cara",
    });
    const job = w.data.jobs.find((j) => j.id === stored!.jobId)!;
    expect(job).toMatchObject({ source: "quote", status: "new", title: "Coil cleaning" });
    const notified = w.notifications().filter((n) => n.type === "quote_decided");
    expect(notified.length).toBeGreaterThan(0);
    expect(notified[0]!.payload).toMatchObject({ actor_name: "Cara", decision: "approved" });

    await expect(
      portalBilling.decidePortalQuote(portalCtx(w), sent.id, { decision: "decline", reason: "Too late" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("declines with a reason, which is required", async () => {
    const w = billingWorld();
    const sent = await quote(w);
    await expect(
      portalBilling.decidePortalQuote(portalCtx(w), sent.id, { decision: "decline" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const q = await portalBilling.decidePortalQuote(portalCtx(w), sent.id, {
      decision: "decline",
      reason: "We'll wait until spring",
    });
    expect(q).toMatchObject({ status: "declined", declineReason: "We'll wait until spring", job: null });
  });

  it("can't decide a quote past its validity or another customer's", async () => {
    const w = billingWorld();
    const stale = await quote(w);
    w.billing().quotes.find((q) => q.id === stale.id)!.validUntil = "2020-01-01";
    expect((await portalBilling.getPortalQuote(portalCtx(w), stale.id)).canDecide).toBe(false);
    await expect(
      portalBilling.decidePortalQuote(portalCtx(w), stale.id, { decision: "approve" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const theirs = await quote(w, { customer: "other" });
    await expect(
      portalBilling.decidePortalQuote(portalCtx(w), theirs.id, { decision: "approve" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("portal invoices", () => {
  it("lists only issued invoices of this customer", async () => {
    const w = billingWorld();
    const sent = await invoice(w);
    await invoice(w, { send: false });
    await invoice(w, { customer: "other" });
    const rows = await portalBilling.listPortalInvoices(portalCtx(w));
    expect(rows).toEqual([
      {
        id: sent.id,
        number: sent.number,
        status: "sent",
        currency: "USD",
        totalMinor: 5000,
        amountPaidMinor: 0,
        balanceMinor: 5000,
        issueDate: sent.issueDate,
        dueDate: sent.dueDate,
        paidAt: null,
      },
    ]);
  });

  it("shows lines without costs, payments without staff details, and whether it can be paid", async () => {
    const w = billingWorld();
    const { job } = await w.completedJob();
    const draft = await invoices.createInvoice(w.ctx(w.dispatcher), { job_id: job.id });
    const sent = await invoices.sendInvoice(w.bctx(w.dispatcher), draft.id);
    await invoices.recordPayment(w.bctx(w.dispatcher), sent.id, {
      amount_minor: 1000,
      method: "bank_transfer",
      reference: "TRX-1",
      note: "Paid late, waived the fee",
    });
    w.data.org.settings.billing.paymentInstructions = "Bank: First Bank, account 123";
    const inv = await portalBilling.getPortalInvoice(portalCtx(w), sent.id);
    expect(inv).toMatchObject({
      status: "sent",
      amountPaidMinor: 1000,
      balanceMinor: sent.totalMinor - 1000,
      canPay: true,
      paymentInstructions: "Bank: First Bank, account 123",
      job: { number: job.number, title: "AC not cooling" },
    });
    for (const l of inv.lines) {
      expect(l).not.toHaveProperty("unitCostMinor");
      expect(l).not.toHaveProperty("markupBps");
      expect(l).not.toHaveProperty("expenseRequestId");
    }
    expect(inv.payments).toEqual([
      {
        id: expect.any(String),
        amountMinor: 1000,
        method: "bank_transfer",
        provider: "manual",
        paidAt: expect.any(Date),
      },
    ]);
  });

  it("a void invoice has no balance and can't be paid; drafts and others' are not found", async () => {
    const w = billingWorld();
    const sent = await invoice(w);
    await invoices.voidInvoice(w.ctx(w.owner), sent.id, { reason: "Duplicate" });
    expect(await portalBilling.getPortalInvoice(portalCtx(w), sent.id)).toMatchObject({
      status: "void",
      balanceMinor: 0,
      canPay: false,
    });
    const draft = await invoice(w, { send: false });
    const theirs = await invoice(w, { customer: "other" });
    for (const id of [draft.id, theirs.id, crypto.randomUUID(), "INV-2026-0001"]) {
      await expect(portalBilling.getPortalInvoice(portalCtx(w), id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("records the first view only", async () => {
    const w = billingWorld();
    const sent = await invoice(w);
    const first = new Date("2026-11-10T10:00:00Z");
    await portalBilling.markPortalInvoiceViewed(portalCtx(w, w.customerId, first), sent.id);
    await portalBilling.markPortalInvoiceViewed(portalCtx(w), sent.id);
    expect(w.billing().invoices.find((x) => x.id === sent.id)!.viewedAt).toEqual(first);
  });
});

describe("portal home", () => {
  it("lists quotes to decide and invoices to pay, overdue first", async () => {
    const w = billingWorld();
    const open = await quote(w);
    const approved = await quote(w);
    await quotes.decideQuote(w.ctx(w.dispatcher), approved.id, { decision: "approve" });
    const due = await invoice(w);
    const late = await invoice(w);
    w.billing().invoices.find((i) => i.id === late.id)!.status = "overdue";
    const paid = await invoice(w);
    await invoices.recordPayment(w.bctx(w.dispatcher), paid.id, { amount_minor: 5000, method: "cash" });
    const summary = await portalBilling.portalBillingSummary(portalCtx(w));
    expect(summary.quotes.map((q) => q.id)).toEqual([open.id]);
    expect(summary.invoices.map((i) => i.id)).toEqual([late.id, due.id]);
  });
});
