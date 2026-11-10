import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../domain/errors";
import { billingWorld, type BillingWorld } from "../test/billing-world";
import { runBillingPass } from "./billing-daily";
import * as invoices from "./invoices";
import * as quotes from "./quotes";
import * as revenue from "./revenue";

const at = (date: string, h = 9) => new Date(`${date}T${String(h).padStart(2, "0")}:00:00Z`);

async function issuedInvoice(w: BillingWorld, amount = 10000) {
  const inv = await invoices.createInvoice(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    lines: [{ kind: "fee", description: "Service", quantity: 1, unit_price_minor: amount, tax_rate_bps: 0 }],
  });
  return invoices.sendInvoice(w.bctx(w.dispatcher), inv.id);
}

const pass = (w: BillingWorld, date: string) =>
  runBillingPass({ store: w.store, now: at(date), customerMailer: w.customerMailer });

describe("runBillingPass", () => {
  it("expires sent quotes after their validity date", async () => {
    const w = billingWorld();
    const q = await quotes.createQuote(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      contact_id: w.caraContactId,
      title: "Quote",
      valid_until: "2026-11-20",
      lines: [{ kind: "fee", description: "Fee", quantity: 1, unit_price_minor: 100, tax_rate_bps: 0 }],
    });
    await quotes.sendQuote(w.bctx(w.dispatcher), q.id);
    expect((await pass(w, "2026-11-20")).expiredQuotes).toBe(0);
    expect((await pass(w, "2026-11-21")).expiredQuotes).toBe(1);
    expect((await quotes.getQuote(w.ctx(w.owner), q.id)).status).toBe("expired");
    expect((await pass(w, "2026-11-22")).expiredQuotes).toBe(0);
  });

  it("marks unpaid invoices overdue and sends each reminder stage once", async () => {
    const w = billingWorld();
    const inv = await issuedInvoice(w); // due 2026-11-24
    const paid = await issuedInvoice(w);
    await invoices.recordPayment(w.bctx(w.owner), paid.id, { amount_minor: paid.totalMinor, method: "cash" });
    w.emails.length = 0;

    expect(await pass(w, "2026-11-24")).toEqual({ expiredQuotes: 0, overdueInvoices: 0, reminders: 0 });
    expect(await pass(w, "2026-11-25")).toEqual({ expiredQuotes: 0, overdueInvoices: 1, reminders: 0 });
    expect((await invoices.getInvoice(w.ctx(w.owner), inv.id)).status).toBe("overdue");
    expect((await pass(w, "2026-11-27")).reminders).toBe(1);
    expect((await pass(w, "2026-11-27")).reminders).toBe(0);
    expect((await pass(w, "2026-12-01")).reminders).toBe(1);
    expect((await pass(w, "2026-12-08")).reminders).toBe(1);
    expect((await pass(w, "2026-12-30")).reminders).toBe(0);
    expect(w.emails.map((e) => e.kind === "invoice_reminder" && e.daysOverdue)).toEqual([3, 7, 14]);
    expect(w.emails[0]).toMatchObject({
      to: "cara@example.com",
      dueDate: "Nov 24, 2026",
      balance: "$100.00",
    });
    expect(w.billing().reminders.map((r) => r.stage)).toEqual([3, 7, 14]);
  });

  it("sends one email for the latest stage when several are due at once", async () => {
    const w = billingWorld();
    w.data.org.settings.billing.remindersEnabled = false;
    await issuedInvoice(w);
    expect((await pass(w, "2026-12-20")).reminders).toBe(0);
    expect(w.billing().reminders).toHaveLength(0);
    w.data.org.settings.billing.remindersEnabled = true;
    w.emails.length = 0;
    expect((await pass(w, "2026-12-20")).reminders).toBe(1);
    expect(w.billing().reminders.map((r) => r.stage)).toEqual([3, 7, 14]);
    expect(w.emails).toHaveLength(1);
  });

  it("skips invoices whose contact has no email", async () => {
    const w = billingWorld();
    const inv = await issuedInvoice(w);
    w.billing().invoices.find((i) => i.id === inv.id)!.contactId = w.noEmailContactId;
    await pass(w, "2026-11-25");
    expect((await pass(w, "2026-11-28")).reminders).toBe(0);
    expect(w.billing().reminders).toHaveLength(0);
  });

  it("doesn't email when the invoice disappeared after its reminder was recorded", async () => {
    const w = billingWorld();
    await issuedInvoice(w);
    await pass(w, "2026-11-25");
    w.store.billing.getInvoice = async () => null;
    expect((await pass(w, "2026-11-28")).reminders).toBe(0);
  });
});

describe("getRevenue", () => {
  it("compares invoiced, collected and receivables with the previous period", async () => {
    const w = billingWorld();
    const a = await issuedInvoice(w, 20000);
    await issuedInvoice(w, 5000);
    const voided = await issuedInvoice(w, 7000);
    await invoices.voidInvoice(w.ctx(w.owner), voided.id, { reason: "Duplicate" });
    await invoices.recordPayment(w.bctx(w.owner), a.id, { amount_minor: 15000, method: "cash" });
    const old = w.billing().invoices[1]!;
    old.issueDate = "2026-10-01";
    old.dueDate = "2026-10-15";

    const r = await revenue.getRevenue(w.ctx(w.owner), { range: "30d" });
    expect(r.currency).toBe("USD");
    expect(r.range).toMatchObject({ from: "2026-10-12", to: "2026-11-10" });
    expect(r.kpis.invoiced).toEqual({ value: 20000, previous: 5000 });
    expect(r.kpis.collected).toEqual({ value: 15000, previous: 0 });
    expect(r.kpis.receivables).toEqual({ value: 10000, previous: 5000 });
    expect(r.kpis.overdue).toEqual({ value: 5000, previous: 0 });
    expect(r.counts).toEqual({ invoices: 1, payments: 1 });
    expect(r.series).toHaveLength(30);
    expect(r.series.at(-1)).toEqual({ bucket: "2026-11-10", invoicedMinor: 20000, collectedMinor: 15000 });

    const weekly = await revenue.getRevenue(w.ctx(w.owner), { range: "90d" });
    expect(weekly.range.bucket).toBe("week");
    expect(weekly.series.reduce((s, b) => s + b.invoicedMinor, 0)).toBe(25000);
  });

  it("is for owners and admins only", async () => {
    const w = billingWorld();
    await expect(revenue.getRevenue(w.ctx(w.dispatcher), {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
