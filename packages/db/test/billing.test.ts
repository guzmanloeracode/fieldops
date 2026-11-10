import {
  catalog,
  ConflictError,
  invoices,
  quotes,
  revenue,
  billingPass,
  type Actor,
  type BillingContext,
  type CustomerEmail,
  type Store,
} from "@fieldops/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Billing repository (FIN-01–07, EXP-04) through the real services, against PostgreSQL with row-level security.

let t: TestDb;
let a: OrgData;
let b: OrgData;
const NOW = new Date("2026-11-11T16:30:00Z");

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "bill");
  b = await createOrgWithData(t.owner, "other");
  // The helper inserted QUO-2026-0001 and INV-2026-0001 by hand; keep the counters in step.
  for (const org of [a, b]) {
    await t.owner.insert(s.orgCounter).values([
      { organizationId: org.orgId, name: "quote:2026", value: 1 },
      { organizationId: org.orgId, name: "invoice:2026", value: 1 },
    ]);
    await t.owner
      .update(s.organization)
      .set({ taxRates: [{ name: "Sales tax", rate_bps: 825, default: true }] })
      .where(eq(s.organization.id, org.orgId));
  }
});
afterAll(async () => t?.close());

function actor(org: OrgData, who: "owner" | "dispatcher" | "tech"): Actor {
  return {
    userId: org.users[who],
    memberId: org.members[who],
    organizationId: org.orgId,
    role: who === "tech" ? "technician" : who,
    name: who,
  };
}

const emails: CustomerEmail[] = [];
const as = <T>(
  org: OrgData,
  who: "owner" | "dispatcher" | "tech",
  fn: (ctx: BillingContext) => Promise<T>,
  now = NOW,
) =>
  withStore(t.app, org.orgId, (store: Store) =>
    fn({
      actor: actor(org, who),
      store,
      now,
      demo: false,
      customerMailer: {
        async send(e) {
          emails.push(e);
        },
      },
    }),
  );

const feeLine = (price: number) => ({
  kind: "fee",
  description: "Diagnosis",
  quantity: 1.5,
  unit: "h",
  unit_price_minor: price,
  tax_rate_bps: 825,
});

async function completedJobWithPart(org: OrgData) {
  await t.owner
    .update(s.job)
    .set({ status: "completed", completedAt: new Date("2026-11-11T12:00:00Z") })
    .where(eq(s.job.id, org.ids.job));
  await t.owner
    .update(s.expenseRequest)
    .set({ status: "approved", decidedAt: new Date("2026-11-11T11:00:00Z"), markupBps: 2000 })
    .where(eq(s.expenseRequest.organizationId, org.orgId));
  const [e] = await t.owner
    .select({ id: s.expenseRequest.id })
    .from(s.expenseRequest)
    .where(eq(s.expenseRequest.organizationId, org.orgId));
  return e!.id;
}

describe("catalog", () => {
  it("creates, searches by name or SKU and keeps SKUs unique per organization", async () => {
    const item = await as(a, "owner", (ctx) =>
      catalog.createCatalogItem(ctx, {
        name: "Filter 16x25x1",
        sku: "FLT-16251",
        unit_price_minor: 1450,
        unit_cost_minor: 600,
        tax_rate_bps: 825,
      }),
    );
    expect(item).toMatchObject({ currency: "USD", unitCostMinor: 600, taxRateBps: 825 });
    const found = await as(a, "dispatcher", (ctx) => catalog.searchCatalog(ctx, "flt-16"));
    expect(found.map((c) => c.id)).toEqual([item.id]);
    expect(
      (await as(a, "dispatcher", (ctx) => catalog.searchCatalog(ctx, "16x25"))).map((c) => c.id),
    ).toEqual([item.id]);
    await expect(
      as(a, "owner", (ctx) =>
        catalog.createCatalogItem(ctx, { name: "Other", sku: "FLT-16251", unit_price_minor: 1 }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    // Another organization may use the same SKU.
    await as(b, "owner", (ctx) =>
      catalog.createCatalogItem(ctx, { name: "Their filter", sku: "FLT-16251", unit_price_minor: 1 }),
    );
    const off = await as(a, "owner", (ctx) => catalog.updateCatalogItem(ctx, item.id, { active: false }));
    expect(off.active).toBe(false);
    expect(await as(a, "dispatcher", (ctx) => catalog.searchCatalog(ctx, "flt"))).toEqual([]);
    expect(
      await as(a, "owner", (ctx) => catalog.listCatalog(ctx, { include_inactive: true, kind: "part" })),
    ).toHaveLength(2);
  });
});

describe("quotes", () => {
  it("persists totals and lines, numbers per year and approves into a job", async () => {
    const q = await as(a, "dispatcher", (ctx) =>
      quotes.createQuote(ctx, {
        customer_id: a.ids.customer,
        site_id: a.ids.site,
        contact_id: a.ids.contact,
        service_type_id: a.ids.serviceType,
        title: "New condenser fan",
        discount_type: "percent",
        discount_value: 1000,
        lines: [feeLine(9500), { ...feeLine(4550), kind: "part", description: "Fan motor", quantity: 2 }],
      }),
    );
    expect(q.number).toBe("QUO-2026-0002");
    const stored = await withStore(t.app, a.orgId, (store) => store.billing.getQuote(q.id));
    expect(stored).toMatchObject({
      subtotalMinor: 14250 + 9100,
      discountMinor: 2335,
      taxMinor: q.taxMinor,
      totalMinor: 23350 - 2335 + q.taxMinor,
      validUntil: "2026-12-11",
      site: { id: a.ids.site, label: "Home", address: { city: "Austin" } },
      contact: { id: a.ids.contact, email: "c-bill@example.com" },
      serviceType: { id: a.ids.serviceType, name: "AC repair" },
    });
    expect(stored!.lines.map((l) => [l.position, l.quantity, l.netMinor])).toEqual([
      [0, 1.5, 14250],
      [1, 2, 9100],
    ]);
    expect(stored!.lines.reduce((x, l) => x + l.taxMinor, 0)).toBe(q.taxMinor);
    expect(
      await withStore(t.app, a.orgId, (store) => store.billing.getQuoteByNumber("QUO-2026-0002")),
    ).not.toBeNull();

    await as(a, "dispatcher", (ctx) => quotes.sendQuote(ctx, q.id));
    expect(emails.at(-1)).toMatchObject({ kind: "quote_sent", to: "c-bill@example.com" });
    const approved = await as(a, "dispatcher", (ctx) =>
      quotes.decideQuote(ctx, q.id, { decision: "approve" }),
    );
    expect(approved).toMatchObject({ status: "approved", decidedByName: "bill dispatcher" });
    expect(approved.job?.number).toBe(2);
    const [job] = await t.owner.select().from(s.job).where(eq(s.job.id, approved.jobId!));
    expect(job).toMatchObject({ source: "quote", status: "new", customerId: a.ids.customer });
    expect((await withStore(t.app, a.orgId, (store) => store.billing.quoteForJob(job!.id)))?.id).toBe(q.id);
    const notified = await t.owner
      .select()
      .from(s.notification)
      .where(and(eq(s.notification.organizationId, a.orgId), eq(s.notification.type, "quote_decided")));
    expect(notified.map((n) => n.userId)).toEqual([a.users.owner]);

    const page = await as(a, "dispatcher", (ctx) =>
      quotes.listQuotes(ctx, { limit: 1, status: ["approved", "draft"], q: "condenser" }),
    );
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await as(a, "dispatcher", (ctx) =>
      quotes.listQuotes(ctx, {
        limit: 1,
        status: ["approved", "draft"],
        q: "condenser",
        cursor: page.nextCursor!,
      }),
    );
    expect(next.rows[0]!.number).toBe("QUO-2026-0001");
    const counted = await as(a, "dispatcher", (ctx) =>
      quotes.listQuotes(ctx, {
        limit: 10,
        page: 1,
        customer: a.ids.customer,
        from: "2026-11-01",
        to: "2026-11-30",
      }),
    );
    expect(counted.total).toBe(2);
    expect(
      (await as(a, "dispatcher", (ctx) => quotes.listQuotes(ctx, { limit: 10, job: job!.id }))).rows,
    ).toHaveLength(1);
  });

  it("expires sent quotes past their validity in the worker pass", async () => {
    const q = await as(a, "dispatcher", (ctx) =>
      quotes.createQuote(ctx, {
        customer_id: a.ids.customer,
        site_id: a.ids.site,
        contact_id: a.ids.contact,
        title: "Short offer",
        valid_until: "2026-11-12",
        lines: [feeLine(100)],
      }),
    );
    await as(a, "dispatcher", (ctx) => quotes.sendQuote(ctx, q.id));
    const r = await withStore(t.app, a.orgId, (store) =>
      billingPass.runBillingPass({ store, now: new Date("2026-11-13T12:00:00Z") }),
    );
    expect(r.expiredQuotes).toBe(1);
    const after = await withStore(t.app, a.orgId, (store) => store.billing.getQuote(q.id));
    expect(after?.status).toBe("expired");
  });
});

describe("invoices", () => {
  it("never gives two concurrent issues the same number", async () => {
    const drafts = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        as(b, "dispatcher", (ctx) =>
          invoices.createInvoice(ctx, { customer_id: b.ids.customer, lines: [feeLine(1000 * n)] }),
        ),
      ),
    );
    const issued = await Promise.all(
      drafts.map((d) => as(b, "dispatcher", (ctx) => invoices.sendInvoice(ctx, d.id))),
    );
    expect(issued.map((i) => i.number).sort()).toEqual([
      "INV-2026-0002",
      "INV-2026-0003",
      "INV-2026-0004",
      "INV-2026-0005",
    ]);
    expect(issued.every((i) => i.issueDate === "2026-11-11" && i.dueDate === "2026-11-25")).toBe(true);
  });

  it("bills an approved part once, even when two invoices race for it", async () => {
    const expenseId = await completedJobWithPart(a);
    const attempt = () => as(a, "dispatcher", (ctx) => invoices.createInvoice(ctx, { job_id: a.ids.job }));
    const results = await Promise.allSettled([attempt(), attempt()]);
    const created = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const withPart = created.filter((inv) => inv.lines.some((l) => l.expenseRequestId === expenseId));
    expect(withPart).toHaveLength(1);
    const line = withPart[0]!.lines.find((l) => l.expenseRequestId === expenseId)!;
    expect(line).toMatchObject({ unitCostMinor: 4500, markupBps: 2000, unitPriceMinor: 5400 });
    // Asking for it explicitly on another invoice is refused.
    await expect(
      as(a, "dispatcher", (ctx) =>
        invoices.createInvoice(ctx, {
          job_id: a.ids.job,
          lines: [{ ...feeLine(1), kind: "part", expense_request_id: expenseId }],
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const billed = await withStore(t.app, a.orgId, (store) => store.billing.billedExpenseIds([expenseId]));
    expect(billed).toEqual([expenseId]);
    // Voiding the invoice frees the part.
    await as(a, "owner", (ctx) => invoices.voidInvoice(ctx, withPart[0]!.id, { reason: "Redo" }));
    expect(await withStore(t.app, a.orgId, (store) => store.billing.billedExpenseIds([expenseId]))).toEqual(
      [],
    );
  });

  it("issues, records payments up to the balance, and reports receivables and revenue", async () => {
    const draft = await as(a, "dispatcher", (ctx) =>
      invoices.createInvoice(ctx, { customer_id: a.ids.customer, lines: [feeLine(10000)] }),
    );
    const sent = await as(a, "dispatcher", (ctx) => invoices.sendInvoice(ctx, draft.id));
    expect(sent.number).toMatch(/^INV-2026-\d{4}$/);
    const events = await t.owner.select().from(s.jobEvent).where(eq(s.jobEvent.type, "invoiced"));
    expect(events).toHaveLength(0);

    const half = Math.floor(sent.totalMinor / 2) - 1; // two fit, a third doesn't
    const results = await Promise.allSettled(
      [half, half, half].map((amount) =>
        as(a, "dispatcher", (ctx) =>
          invoices.recordPayment(ctx, sent.id, {
            amount_minor: amount,
            method: "bank_transfer",
            reference: "T",
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const after = await as(a, "owner", (ctx) => invoices.getInvoice(ctx, sent.id));
    expect(after.amountPaidMinor).toBe(half * 2);
    expect(after.payments).toHaveLength(2);
    expect(after.payments[0]!.recordedBy).toEqual({ id: a.users.dispatcher, name: "bill dispatcher" });
    const rest = after.totalMinor - after.amountPaidMinor;
    const paid = await as(a, "dispatcher", (ctx) =>
      invoices.recordPayment(ctx, sent.id, { amount_minor: rest, method: "cash" }),
    );
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toEqual(NOW);
    expect(emails.filter((e) => e.kind === "payment_receipt")).toHaveLength(3);

    // The helper's own payment is dated tomorrow, so it isn't in these periods yet.
    const r = await as(a, "owner", (ctx) => revenue.getRevenue(ctx, { range: "7d" }));
    expect(r.kpis.collected.value).toBe(after.totalMinor);
    expect(r.kpis.invoiced.value).toBeGreaterThanOrEqual(after.totalMinor);
    expect(r.series.find((x) => x.bucket === "2026-11-11")?.collectedMinor).toBe(after.totalMinor);
    const weekly = await as(a, "owner", (ctx) => revenue.getRevenue(ctx, { range: "90d" }));
    expect(weekly.series.reduce((x, w) => x + w.collectedMinor, 0)).toBe(after.totalMinor);

    const open = await as(a, "owner", (ctx) => invoices.receivablesNow(ctx));
    // The helper's INV-2026-0001 (25.00, its payment dated tomorrow) is still open.
    expect(open).toMatchObject({ outstandingMinor: 2500, outstandingCount: 1, overdueMinor: 0 });
    const list = await as(a, "owner", (ctx) =>
      invoices.listInvoices(ctx, {
        limit: 10,
        page: 1,
        status: ["paid"],
        q: sent.number!,
        from: "2026-11-11",
      }),
    );
    expect(list.rows.map((x) => x.id)).toEqual([sent.id]);
  });

  it("marks overdue invoices and records each reminder once", async () => {
    const pass = (date: string) =>
      withStore(t.app, a.orgId, (store) =>
        billingPass.runBillingPass({
          store,
          now: new Date(`${date}T18:00:00Z`),
          customerMailer: {
            async send(e) {
              emails.push(e);
            },
          },
        }),
      );
    // The helper's invoice is due 2026-11-24 with a balance; its stage 3 reminder is already recorded.
    expect((await pass("2026-11-25")).overdueInvoices).toBeGreaterThanOrEqual(1);
    expect((await pass("2026-11-28")).reminders).toBe(0);
    expect((await pass("2026-12-02")).reminders).toBe(1);
    expect((await pass("2026-12-02")).reminders).toBe(0);
    const stages = await t.owner
      .select({ stage: s.invoiceReminder.stage })
      .from(s.invoiceReminder)
      .where(eq(s.invoiceReminder.organizationId, a.orgId));
    expect(stages.map((x) => x.stage).sort()).toEqual([3, 7]);
    expect(emails.at(-1)).toMatchObject({ kind: "invoice_reminder", daysOverdue: 8 });
  });
});

describe("tenant isolation", () => {
  it("never shows another organization's billing records", async () => {
    const [aQuote] = await t.owner.select().from(s.quote).where(eq(s.quote.organizationId, a.orgId));
    const [aInvoice] = await t.owner.select().from(s.invoice).where(eq(s.invoice.organizationId, a.orgId));
    const [aItem] = await t.owner
      .select()
      .from(s.catalogItem)
      .where(eq(s.catalogItem.organizationId, a.orgId));
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.billing.getQuote(aQuote!.id)).toBeNull();
      expect(await store.billing.getInvoice(aInvoice!.id)).toBeNull();
      expect(await store.billing.getCatalogItem(aItem!.id)).toBeNull();
      expect(await store.billing.updateQuote(aQuote!.id, { title: "x" })).toBeNull();
      expect(await store.billing.updateInvoice(aInvoice!.id, { notes: "x" })).toBeNull();
      expect(await store.billing.applyPaymentToInvoice(aInvoice!.id, 1, NOW)).toBeNull();
      const quotesB = await store.billing.listQuotes({ limit: 50 });
      expect(quotesB.rows.every((q) => q.customer.id === b.ids.customer)).toBe(true);
      const invoicesB = await store.billing.listInvoices({ limit: 50 });
      expect(invoicesB.rows.every((i) => i.customer.id === b.ids.customer)).toBe(true);
      expect(await store.billing.findPayment("manual", "nope")).toBeNull();
    });
    // Row-level security: the runtime role sees nothing of A even without the repository's filter.
    const rows = await withStore(t.app, b.orgId, (_store, tx) =>
      tx.execute(sql`select count(*)::int as n from invoice where organization_id = ${a.orgId}`),
    );
    expect(rows.rows[0]).toEqual({ n: 0 });
  });

  it("queues customer emails in the outbox", async () => {
    await withStore(t.app, a.orgId, (store) =>
      store.billing.queueEmail({
        toEmail: "Cara@Example.com",
        subject: "Invoice",
        html: "<p>x</p>",
        text: "x",
        kind: "billing.invoice_sent",
        captured: true,
      }),
    );
    const [row] = await t.owner
      .select()
      .from(s.emailOutbox)
      .where(eq(s.emailOutbox.kind, "billing.invoice_sent"));
    expect(row).toMatchObject({ toEmail: "cara@example.com", status: "captured", organizationId: a.orgId });
  });
});
