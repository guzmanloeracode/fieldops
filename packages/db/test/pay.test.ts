import {
  invoices,
  NotFoundError,
  payments,
  portalBilling,
  type Actor,
  type BillingContext,
  type CheckoutDeps,
  type PaymentProvider,
  type PortalContext,
  type Store,
} from "@fieldops/core";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Online payments and the portal's quotes and invoices (FIN-05, POR-04) on the billing repository, against
// PostgreSQL with row-level security: stored checkout sessions, first views, and webhook idempotency through the
// unique index on (organization, provider, reference).

let t: TestDb;
let a: OrgData;
let b: OrgData;
const HOUR = 3_600_000;

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "pay");
  b = await createOrgWithData(t.owner, "other");
  for (const org of [a, b]) {
    await t.owner.insert(s.orgCounter).values([
      { organizationId: org.orgId, name: "quote:2026", value: 1 },
      { organizationId: org.orgId, name: "invoice:2026", value: 1 },
    ]);
  }
});
afterAll(async () => t?.close());

const dispatcher = (org: OrgData): Actor => ({
  userId: org.users.dispatcher,
  memberId: org.members.dispatcher,
  organizationId: org.orgId,
  role: "dispatcher",
  name: "dispatcher",
});

const as = <T>(org: OrgData, fn: (ctx: BillingContext) => Promise<T>) =>
  withStore(t.app, org.orgId, (store: Store) =>
    fn({
      actor: dispatcher(org),
      store,
      now: new Date(),
      demo: false,
      customerMailer: { send: async () => {} },
    }),
  );

const portal = <T>(org: OrgData, fn: (ctx: PortalContext) => Promise<T>, now = new Date()) =>
  withStore(t.app, org.orgId, (store: Store) =>
    fn({
      portal: {
        organizationId: org.orgId,
        customerId: org.ids.customer,
        customerName: "Customer",
        contactId: org.ids.contact,
        contactName: "Contact",
      },
      store,
      now,
      demo: false,
    }),
  );

function provider(): PaymentProvider & { calls: number } {
  return {
    name: "simulated",
    calls: 0,
    async createCheckout(req, now) {
      this.calls += 1;
      return {
        sessionId: `sim_${req.invoiceId.slice(0, 8)}${this.calls}aaaaaaaaaaaa`,
        url: `https://app.example/checkout/${this.calls}`,
        expiresAt: new Date(now.getTime() + HOUR),
      };
    },
  };
}

const deps = (org: OrgData, p: PaymentProvider, now = new Date()): CheckoutDeps => ({
  provider: p,
  appUrl: "https://app.example",
  now,
  run: (fn) => withStore(t.app, org.orgId, fn),
});

async function issuedInvoice(org: OrgData, price = 10_000) {
  return as(org, async (ctx) => {
    const draft = await invoices.createInvoice(ctx, {
      customer_id: org.ids.customer,
      lines: [{ kind: "fee", description: "Visit", quantity: 1, unit_price_minor: price, tax_rate_bps: 0 }],
    });
    return invoices.sendInvoice(ctx, draft.id);
  });
}

describe("checkout sessions", () => {
  it("stores, reuses and drops the session without touching the invoice's version", async () => {
    const inv = await issuedInvoice(a);
    const p = provider();
    const first = await payments.checkoutForInvoice(deps(a, p), dispatcher(a), inv.id);
    const again = await payments.checkoutForPortal(
      deps(a, p),
      {
        organizationId: a.orgId,
        customerId: a.ids.customer,
        customerName: "",
        contactId: a.ids.contact,
        contactName: "",
      },
      inv.id,
    );
    expect(again).toMatchObject({ sessionId: first.sessionId, reused: true });
    expect(p.calls).toBe(1);
    const [row] = await t.owner.select().from(s.invoice).where(eq(s.invoice.id, inv.id));
    expect(row).toMatchObject({
      checkoutSessionId: first.sessionId,
      checkoutUrl: first.url,
      checkoutExpiresAt: first.expiresAt,
      version: inv.version,
    });

    // Another organization can't see or overwrite it.
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.billing.getCheckout(inv.id)).toBeNull();
      expect(
        await store.billing.saveCheckout(inv.id, { sessionId: "sim_x", url: "u", expiresAt: new Date() }),
      ).toBe(false);
    });

    await as(a, (ctx) => invoices.recordPayment(ctx, inv.id, { amount_minor: 4000, method: "cash" }));
    expect(await withStore(t.app, a.orgId, (store) => store.billing.getCheckout(inv.id))).toBeNull();
  });

  it("won't store a session on a paid or void invoice", async () => {
    const inv = await issuedInvoice(a);
    await as(a, (ctx) => invoices.voidInvoice(ctx, inv.id, { reason: "Wrong" }));
    const saved = await withStore(t.app, a.orgId, (store) =>
      store.billing.saveCheckout(inv.id, { sessionId: "sim_x", url: "u", expiresAt: new Date() }),
    );
    expect(saved).toBe(false);
  });
});

describe("webhook idempotency", () => {
  it("records one payment when the same event arrives twice, even at the same time", async () => {
    const inv = await issuedInvoice(a, 7000);
    const event = {
      provider: "stripe" as const,
      providerRef: `pi_${inv.id.slice(0, 8)}`,
      sessionId: "cs_test_1",
      organizationId: a.orgId,
      invoiceId: inv.id,
      amountMinor: 7000,
      currency: "USD" as const,
      paidAt: new Date(),
    };
    const confirm = () =>
      withStore(t.app, a.orgId, (store) =>
        payments.confirmOnlinePayment(
          { store, now: new Date(), customerMailer: { send: async () => {} } },
          event,
        ),
      );
    const results = await Promise.allSettled([confirm(), confirm()]);
    expect(results.filter((r) => r.status === "fulfilled" && r.value.outcome === "recorded")).toHaveLength(1);
    // A later redelivery is a no-op.
    expect((await confirm()).outcome).toBe("duplicate");
    const rows = await t.owner
      .select()
      .from(s.payment)
      .where(and(eq(s.payment.organizationId, a.orgId), eq(s.payment.invoiceId, inv.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "stripe",
      providerRef: event.providerRef,
      method: "card",
      recordedBy: null,
    });
    const [after] = await t.owner.select().from(s.invoice).where(eq(s.invoice.id, inv.id));
    expect(after).toMatchObject({ status: "paid", amountPaidMinor: 7000 });
  });

  it("pays through the simulated checkout once", async () => {
    const inv = await issuedInvoice(a, 3000);
    const link = await payments.checkoutForInvoice(deps(a, provider()), dispatcher(a), inv.id);
    const claim = { invoiceId: inv.id, sessionId: link.sessionId };
    const pay = () =>
      withStore(t.app, a.orgId, (store) =>
        payments.payTestCheckout({ store, now: new Date(), customerMailer: { send: async () => {} } }, claim),
      );
    expect((await pay()).outcome).toBe("recorded");
    expect((await pay()).outcome).toBe("duplicate");
    const view = await withStore(t.app, a.orgId, (store) => payments.testCheckout(store, new Date(), claim));
    expect(view).toMatchObject({ state: "paid", amountMinor: 3000 });
  });
});

describe("portal quotes and invoices", () => {
  it("records the first view without a version bump or an audit entry", async () => {
    const inv = await issuedInvoice(a);
    const first = new Date("2026-11-10T10:00:00Z");
    await portal(a, (ctx) => portalBilling.markPortalInvoiceViewed(ctx, inv.id), first);
    await portal(a, (ctx) => portalBilling.markPortalInvoiceViewed(ctx, inv.id));
    const [row] = await t.owner.select().from(s.invoice).where(eq(s.invoice.id, inv.id));
    expect(row).toMatchObject({ viewedAt: first, version: inv.version });
    const audits = await t.owner
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, inv.id), eq(s.auditLog.action, "invoice.update")));
    expect(audits.filter((x) => JSON.stringify(x).includes("viewed_at"))).toHaveLength(0);
  });

  it("shows a customer only their own issued invoices and sent quotes", async () => {
    const mine = await issuedInvoice(a);
    const theirs = await issuedInvoice(b);
    const rows = await portal(a, (ctx) => portalBilling.listPortalInvoices(ctx));
    expect(rows.map((r) => r.id)).toContain(mine.id);
    expect(rows.map((r) => r.id)).not.toContain(theirs.id);
    await expect(portal(a, (ctx) => portalBilling.getPortalInvoice(ctx, theirs.id))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // The helper's QUO-2026-0001 is still a draft: not shown.
    expect(await portal(a, (ctx) => portalBilling.listPortalQuotes(ctx))).toEqual([]);
  });
});
