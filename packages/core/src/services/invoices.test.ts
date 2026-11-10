import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../domain/errors";
import { billingWorld, type BillingWorld } from "../test/billing-world";
import * as invoices from "./invoices";
import * as quotes from "./quotes";

async function fromJob(w: BillingWorld) {
  const fixture = await w.completedJob();
  const inv = await invoices.createInvoice(w.ctx(w.dispatcher), { job_id: fixture.job.id });
  return { ...fixture, inv };
}

async function issued(w: BillingWorld) {
  const f = await fromJob(w);
  const inv = await invoices.sendInvoice(w.bctx(w.dispatcher), f.inv.id);
  return { ...f, inv };
}

const blank = (w: BillingWorld, over: Record<string, unknown> = {}) =>
  invoices.createInvoice(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    lines: [
      {
        kind: "fee",
        description: "Call-out fee",
        quantity: 1,
        unit_price_minor: 7500,
        tax_rate_bps: 0,
      },
    ],
    ...over,
  });

describe("prefillFromJob", () => {
  it("bills the service, labor per technician and approved parts at cost plus markup", async () => {
    const w = billingWorld();
    const { job, part, parking } = await w.completedJob();
    w.data.serviceTypes[0]!.taxRateBps = 500;
    const p = await invoices.prefillFromJob(w.ctx(w.dispatcher), job.id);
    expect(p.customerId).toBe(w.customerId);
    expect(p.siteId).toBe(w.siteId);
    expect(p.contactId).toBe(w.caraContactId);
    expect(p.quote).toBeNull();
    expect(
      p.lines.map((l) => [l.kind, l.description, l.quantity, l.unit_price_minor, l.tax_rate_bps]),
    ).toEqual([
      ["service", "AC repair", 1, 18900, 500],
      ["labor", "Labor: Tom Tech", 1.25, 9500, 825],
      ["labor", "Labor: Rina Tech", 0.5, 9500, 825],
      ["part", "Capacitor 35/5 µF", 1, 2400, 825],
      ["expense", "Parking", 2, 500, 825],
    ]);
    expect(p.lines[3]!.expense_request_id).toBe(part.id);
    expect(p.lines[4]!.expense_request_id).toBe(parking.id);
  });

  it("uses the default rate for a service type without its own, and works without a service type", async () => {
    const w = billingWorld();
    const { job } = await w.completedJob({ serviceType: false });
    const p = await invoices.prefillFromJob(w.ctx(w.dispatcher), job.id);
    expect(p.lines[0]!.kind).toBe("labor");
    const w2 = billingWorld();
    const { job: j2 } = await w2.completedJob();
    expect((await invoices.prefillFromJob(w2.ctx(w2.dispatcher), j2.id)).lines[0]!.tax_rate_bps).toBe(825);
  });

  it("takes the approved quote's lines and discount instead of the service line", async () => {
    const w = billingWorld();
    const q = await quotes.createQuote(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      contact_id: w.caraContactId,
      title: "Fan",
      discount_type: "amount",
      discount_value: 1000,
      lines: [
        { kind: "part", description: "Fan motor", quantity: 1, unit_price_minor: 12000, tax_rate_bps: 825 },
      ],
    });
    await quotes.sendQuote(w.bctx(w.dispatcher), q.id);
    const approved = await quotes.decideQuote(w.ctx(w.dispatcher), q.id, { decision: "approve" });
    w.data.jobs.find((j) => j.id === approved.jobId)!.status = "completed";
    const p = await invoices.prefillFromJob(w.ctx(w.dispatcher), approved.jobId!);
    expect(p.quote?.number).toBe("QUO-2026-0001");
    expect(p.lines.map((l) => l.description)).toEqual(["Fan motor"]);
    expect(p.discountType).toBe("amount");
    const inv = await invoices.createInvoice(w.ctx(w.dispatcher), { job_id: approved.jobId });
    expect(inv.quote?.number).toBe("QUO-2026-0001");
    expect(inv.discountMinor).toBe(1000);
  });

  it("leaves out parts already billed, and bills them again once that invoice is void", async () => {
    const w = billingWorld();
    const { job, inv } = await fromJob(w);
    const again = await invoices.prefillFromJob(w.ctx(w.dispatcher), job.id);
    expect(again.lines.some((l) => l.expense_request_id)).toBe(false);
    await invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "Wrong customer" });
    const after = await invoices.prefillFromJob(w.ctx(w.dispatcher), job.id);
    expect(after.lines.filter((l) => l.expense_request_id)).toHaveLength(2);
  });
});

describe("createInvoice", () => {
  it("creates a numberless draft from a completed job", async () => {
    const w = billingWorld();
    const { inv, job } = await fromJob(w);
    expect(inv.status).toBe("draft");
    expect(inv.number).toBeNull();
    expect(inv.job).toEqual({ id: job.id, number: job.number, title: job.title });
    expect(inv.lines).toHaveLength(5);
    expect(inv.subtotalMinor).toBe(18900 + 11875 + 4750 + 2400 + 1000);
    expect(inv.totalMinor).toBe(inv.subtotalMinor + inv.taxMinor);
    expect((await invoices.invoicesForJob(w.ctx(w.admin), job.id)).map((i) => i.id)).toEqual([inv.id]);
  });

  it("refuses open jobs and another customer's job", async () => {
    const w = billingWorld();
    const { job } = await w.completedJob();
    await expect(
      invoices.createInvoice(w.ctx(w.dispatcher), { job_id: job.id, customer_id: w.otherCustomerId }),
    ).rejects.toThrow(/another customer/);
    w.data.jobs.find((j) => j.id === job.id)!.status = "in_progress";
    await expect(invoices.createInvoice(w.ctx(w.dispatcher), { job_id: job.id })).rejects.toThrow(
      /completed/,
    );
  });

  it("creates a blank invoice for a customer with its primary contact", async () => {
    const w = billingWorld();
    const inv = await blank(w, { notes: "Thank you", discount_type: "percent", discount_value: 1000 });
    expect(inv.jobId).toBeNull();
    expect(inv.contactId).toBe(w.caraContactId);
    expect(inv.siteId).toBeNull();
    expect(inv.totalMinor).toBe(6750);
    expect(inv.notes).toBe("Thank you");
    const none = await invoices.createInvoice(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      contact_id: null,
      site_id: w.siteId,
    });
    expect(none.contactId).toBeNull();
    expect(none.lines).toHaveLength(0);
  });

  it("bills a part only once, only from its own job and only when approved", async () => {
    const w = billingWorld();
    const { job, part, rejected } = await fromJob(w);
    const line = (id: string, markup = 0) => ({
      kind: "part",
      description: "Part",
      quantity: 9,
      unit_price_minor: 1,
      tax_rate_bps: 0,
      expense_request_id: id,
      markup_bps: markup,
    });
    await expect(
      invoices.createInvoice(w.ctx(w.dispatcher), { job_id: job.id, lines: [line(part.id)] }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      invoices.createInvoice(w.ctx(w.dispatcher), { job_id: job.id, lines: [line(rejected.id)] }),
    ).rejects.toThrow(/approved parts/);
    await expect(blank(w, { lines: [line(part.id)] })).rejects.toThrow(/approved parts/);
    await expect(
      invoices.createInvoice(w.ctx(w.dispatcher), { job_id: job.id, lines: [line(part.id), line(part.id)] }),
    ).rejects.toThrow(/only be billed once/);
    await expect(
      invoices.createInvoice(w.ctx(w.dispatcher), {
        job_id: job.id,
        lines: [line("00000000-0000-4000-8000-00000000ffff")],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("takes quantity and cost from the request and prices it with the line's markup", async () => {
    const w = billingWorld();
    const { job, parking } = await w.completedJob();
    const inv = await invoices.createInvoice(w.ctx(w.dispatcher), {
      job_id: job.id,
      lines: [
        {
          kind: "expense",
          description: "Parking downtown",
          quantity: 9,
          unit_price_minor: 1,
          tax_rate_bps: 0,
          expense_request_id: parking.id,
          markup_bps: 2000,
        },
      ],
    });
    expect(inv.lines[0]).toMatchObject({
      description: "Parking downtown",
      quantity: 2,
      unitCostMinor: 500,
      markupBps: 2000,
      unitPriceMinor: 600,
      netMinor: 1200,
    });
  });

  it("is for office roles and needs a customer or a job", async () => {
    const w = billingWorld();
    await expect(blank(w, {})).resolves.toBeTruthy();
    await expect(invoices.createInvoice(w.ctx(w.tom), { customer_id: w.customerId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(invoices.createInvoice(w.ctx(w.dispatcher), {})).rejects.toBeInstanceOf(ValidationError);
    await expect(
      invoices.createInvoice(w.ctx(w.dispatcher), { customer_id: w.customerId, site_id: w.otherSiteId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("getInvoice and lists", () => {
  it("finds invoices and lists them with filters and a receivables summary", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    await blank(w);
    expect((await invoices.getInvoice(w.ctx(w.admin), inv.id)).id).toBe(inv.id);
    await expect(invoices.getInvoice(w.ctx(w.admin), "INV-2026-0001")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      invoices.getInvoice(w.ctx(w.admin), "00000000-0000-4000-8000-00000000ffff"),
    ).rejects.toBeInstanceOf(NotFoundError);
    const sentOnly = await invoices.listInvoices(w.ctx(w.admin), {
      limit: 10,
      page: 1,
      status: ["sent"],
      from: "2026-11-01",
      to: "2026-11-30",
      q: "inv-2026",
    });
    expect(sentOnly.total).toBe(1);
    const r = await invoices.receivablesNow(w.ctx(w.admin));
    expect(r).toMatchObject({
      currency: "USD",
      outstandingMinor: inv.totalMinor,
      outstandingCount: 1,
      overdueMinor: 0,
    });
  });
});

describe("updateInvoice", () => {
  it("edits a draft's lines, contact, notes and discount", async () => {
    const w = billingWorld();
    const inv = await blank(w);
    const u = await invoices.updateInvoice(
      w.ctx(w.dispatcher),
      inv.id,
      {
        contact_id: w.noEmailContactId,
        site_id: w.siteId,
        notes: "Paid on site",
        discount_type: "amount",
        discount_value: 500,
        lines: [
          { kind: "fee", description: "Diagnosis", quantity: 1, unit_price_minor: 5000, tax_rate_bps: 825 },
        ],
      },
      inv.version,
    );
    expect(u).toMatchObject({ contactId: w.noEmailContactId, siteId: w.siteId, notes: "Paid on site" });
    expect(u.lines.map((l) => l.description)).toEqual(["Diagnosis"]);
    expect(u.totalMinor).toBe(4500 + 371);
    const d = await invoices.updateInvoice(w.ctx(w.dispatcher), inv.id, { discount_value: 1000 });
    expect(d.discountMinor).toBe(1000);
    expect(d.lines).toHaveLength(1);
    const n = await invoices.updateInvoice(w.ctx(w.dispatcher), inv.id, { discount_type: null });
    expect(n.discountMinor).toBe(0);
  });

  it("keeps the draft's own parts when its lines are saved again", async () => {
    const w = billingWorld();
    const { inv } = await fromJob(w);
    const lines = inv.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unit_price_minor: l.unitPriceMinor,
      tax_rate_bps: l.taxRateBps,
      expense_request_id: l.expenseRequestId,
      markup_bps: l.expenseRequestId ? 1000 : 0,
    }));
    const u = await invoices.updateInvoice(w.ctx(w.dispatcher), inv.id, { lines });
    expect(u.lines.find((l) => l.kind === "part")!.unitPriceMinor).toBe(2640);
  });

  it("refuses stale versions, other customers' contacts and issued invoices", async () => {
    const w = billingWorld();
    const inv = await blank(w);
    await expect(
      invoices.updateInvoice(w.ctx(w.dispatcher), inv.id, { notes: "x" }, 42),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    await expect(
      invoices.updateInvoice(w.ctx(w.dispatcher), inv.id, { contact_id: w.otherContactId }),
    ).rejects.toBeInstanceOf(ValidationError);
    const original = w.store.billing.updateInvoice;
    w.store.billing.updateInvoice = async () => null;
    await expect(invoices.updateInvoice(w.ctx(w.dispatcher), inv.id, { notes: "x" })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    w.store.billing.updateInvoice = original;
    await invoices.sendInvoice(w.bctx(w.dispatcher), inv.id);
    await expect(invoices.updateInvoice(w.ctx(w.dispatcher), inv.id, { notes: "x" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("sendInvoice", () => {
  it("issues a draft: number, dates, the job event and the email", async () => {
    const w = billingWorld();
    w.data.org.settings.billing.paymentInstructions = "Bank: 123";
    const { inv, job } = await issued(w);
    expect(inv).toMatchObject({
      status: "sent",
      number: "INV-2026-0001",
      issueDate: "2026-11-10",
      dueDate: "2026-11-24",
      contactId: w.caraContactId,
    });
    const events = await w.store.jobs.events(job.id);
    expect(events.find((e) => e.type === "invoiced")?.payload).toMatchObject({
      invoice_number: "INV-2026-0001",
      total_minor: inv.totalMinor,
    });
    expect(w.emails[0]).toMatchObject({
      kind: "invoice_sent",
      to: "cara@example.com",
      path: `/portal/acme/invoices/${inv.id}`,
      number: "INV-2026-0001",
      dueDate: "Nov 24, 2026",
      paymentInstructions: "Bank: 123",
    });
    const second = await blank(w);
    expect((await invoices.sendInvoice(w.bctx(w.dispatcher), second.id)).number).toBe("INV-2026-0002");
  });

  it("emails an issued invoice again without changing its number", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    const again = await invoices.sendInvoice(w.bctx(w.dispatcher), inv.id, {});
    expect(again.number).toBe("INV-2026-0001");
    expect(w.emails).toHaveLength(2);
    const original = w.store.billing.updateInvoice;
    w.store.billing.updateInvoice = async () => null;
    await expect(invoices.sendInvoice(w.bctx(w.dispatcher), inv.id)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await expect(invoices.sendInvoice(w.bctx(w.dispatcher), (await blank(w)).id)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    w.store.billing.updateInvoice = original;
  });

  it("needs lines with a total, a contact with an email, and an unbilled part list", async () => {
    const w = billingWorld();
    const empty = await invoices.createInvoice(w.ctx(w.dispatcher), { customer_id: w.customerId });
    await expect(invoices.sendInvoice(w.bctx(w.dispatcher), empty.id)).rejects.toThrow(/above zero/);
    const noEmail = await blank(w, { contact_id: w.noEmailContactId });
    await expect(invoices.sendInvoice(w.bctx(w.dispatcher), noEmail.id)).rejects.toThrow(/email/);

    const { inv, job } = await fromJob(w);
    // A second draft bills the same parts after the first one was voided, then the first comes back to life.
    await invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "Redo" });
    const other = await invoices.createInvoice(w.ctx(w.dispatcher), { job_id: job.id });
    w.billing().invoices.find((i) => i.id === inv.id)!.status = "draft";
    await expect(invoices.sendInvoice(w.bctx(w.dispatcher), other.id)).rejects.toThrow(/already billed/);
  });

  it("doesn't send void or paid invoices", async () => {
    const w = billingWorld();
    const inv = await blank(w);
    await invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "Duplicate" });
    await expect(invoices.sendInvoice(w.bctx(w.dispatcher), inv.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("voidInvoice", () => {
  it("voids drafts and unpaid invoices with a reason", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    const v = await invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, {
      reason: "Billed the wrong customer",
    });
    expect(v).toMatchObject({ status: "void", voidReason: "Billed the wrong customer" });
    expect(v.voidedAt).toEqual(new Date("2026-11-10T09:00:00Z"));
    await expect(invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "Again" })).rejects.toThrow(
      /already void/,
    );
    await expect(invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuses invoices with payments and paid ones", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    await invoices.recordPayment(w.bctx(w.owner), inv.id, { amount_minor: 1000, method: "cash" });
    await expect(invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "Oops" })).rejects.toThrow(
      /with payments/,
    );
    const rest = (await invoices.getInvoice(w.ctx(w.owner), inv.id)).totalMinor - 1000;
    await invoices.recordPayment(w.bctx(w.owner), inv.id, { amount_minor: rest, method: "bank_transfer" });
    await expect(invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "Oops" })).rejects.toThrow(
      /paid/,
    );
  });

  it("reports a concurrent change", async () => {
    const w = billingWorld();
    const inv = await blank(w);
    w.store.billing.updateInvoice = async () => null;
    await expect(
      invoices.voidInvoice(w.ctx(w.dispatcher), inv.id, { reason: "Oops" }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});

describe("recordPayment", () => {
  it("records partial and full payments; the invoice becomes paid", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    const part = await invoices.recordPayment(w.bctx(w.dispatcher), inv.id, {
      amount_minor: 10000,
      method: "bank_transfer",
      reference: "TRX-1",
      paid_at: "2026-11-10T08:00:00Z",
    });
    expect(part.status).toBe("sent");
    expect(part.amountPaidMinor).toBe(10000);
    expect(part.payments[0]).toMatchObject({
      amountMinor: 10000,
      method: "bank_transfer",
      provider: "manual",
      reference: "TRX-1",
      recordedBy: { id: w.dispatcher.userId, name: "Dan Dispatcher" },
    });
    const full = await invoices.recordPayment(w.bctx(w.dispatcher), inv.id, {
      amount_minor: inv.totalMinor - 10000,
      method: "cash",
    });
    expect(full.status).toBe("paid");
    expect(full.paidAt).toEqual(new Date("2026-11-10T09:00:00Z"));
    const receipts = w.emails.filter((e) => e.kind === "payment_receipt");
    expect(receipts).toHaveLength(2);
    expect(receipts[1]).toMatchObject({ balance: "$0.00", method: "cash", paidAt: "Nov 10, 2026" });
    const notified = w.notifications().filter((n) => n.type === "payment_received");
    expect(notified.map((n) => n.userId)).toEqual([w.owner.userId, w.owner.userId]);
    expect(notified[0]!.payload).toMatchObject({ invoice_number: "INV-2026-0001", amount: "$100.00" });
  });

  it("doesn't notify the owner who recorded it", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    await invoices.recordPayment(w.bctx(w.owner), inv.id, { amount_minor: 100, method: "cash" });
    expect(w.notifications().filter((n) => n.type === "payment_received")).toHaveLength(0);
  });

  it("refuses more than the balance, future dates, drafts and lost races", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    await expect(
      invoices.recordPayment(w.bctx(w.dispatcher), inv.id, {
        amount_minor: inv.totalMinor + 1,
        method: "cash",
      }),
    ).rejects.toThrow(/more than the balance/);
    await expect(
      invoices.recordPayment(w.bctx(w.dispatcher), inv.id, {
        amount_minor: 100,
        method: "cash",
        paid_at: "2026-11-11T09:00:00Z",
      }),
    ).rejects.toThrow(/future/);
    const draft = await blank(w);
    await expect(
      invoices.recordPayment(w.bctx(w.dispatcher), draft.id, { amount_minor: 100, method: "cash" }),
    ).rejects.toThrow(/Issue the invoice/);
    await invoices.voidInvoice(w.ctx(w.dispatcher), draft.id, { reason: "Dup" });
    await expect(
      invoices.recordPayment(w.bctx(w.dispatcher), draft.id, { amount_minor: 100, method: "cash" }),
    ).rejects.toThrow(/void invoice/);
    w.store.billing.applyPaymentToInvoice = async () => null;
    await expect(
      invoices.recordPayment(w.bctx(w.dispatcher), inv.id, { amount_minor: 100, method: "cash" }),
    ).rejects.toThrow(/changed meanwhile/);
  });

  it("skips the receipt when the invoice's contact has no email", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    w.billing().invoices[0]!.contactId = w.noEmailContactId;
    await invoices.recordPayment(w.bctx(w.dispatcher), inv.id, { amount_minor: 100, method: "cash" });
    expect(w.emails.filter((e) => e.kind === "payment_receipt")).toHaveLength(0);
  });

  it("applies a provider's payment once (idempotent webhooks)", async () => {
    const w = billingWorld();
    const { inv } = await issued(w);
    const payment = {
      amountMinor: 500,
      method: "card" as const,
      provider: "stripe",
      providerRef: "pi_123",
      reference: null,
      note: null,
      paidAt: new Date("2026-11-10T08:30:00Z"),
    };
    const deps = { store: w.store, now: new Date("2026-11-10T09:00:00Z") };
    const view = await invoices.getInvoice(w.ctx(w.owner), inv.id);
    await invoices.applyPayment(deps, view, payment, { userId: null, name: null });
    const again = await invoices.applyPayment(deps, view, payment, { userId: null, name: null });
    expect(again.amountPaidMinor).toBe(500);
    expect(again.payments).toHaveLength(1);
    expect(w.notifications().filter((n) => n.type === "payment_received")).toHaveLength(1);
  });
});
