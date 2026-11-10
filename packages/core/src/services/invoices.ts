import {
  documentSendSchema,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  invoiceVoidSchema,
  paymentCreateSchema,
  type InvoiceLineInput,
  type InvoiceListQuery,
  type PaymentMethod,
} from "@fieldops/shared";
import {
  balanceOf,
  billableHours,
  defaultTaxRate,
  isInvoiceEditable,
  isInvoiceOpen,
  markedUp,
  voidBlocker,
} from "../domain/billing";
import { addDays } from "../domain/date-range";
import { ConflictError, NotFoundError, PreconditionFailedError, ValidationError } from "../domain/errors";
import { formatYearlyNumber } from "../domain/numbering";
import { assertCan } from "../domain/permissions";
import {
  UUID,
  checkContact,
  checkLineRefs,
  checkSite,
  customerLocale,
  dateText,
  moneyText,
  portalPath,
  priceLines,
  recipientFor,
  requireCustomer,
  todayIn,
  totalsPatch,
  type BillingDeps,
} from "./billing-common";
import type {
  BillingContext,
  CustomerMailer,
  InvoiceLineRecord,
  InvoicePatch,
  InvoiceView,
  NewInvoiceLine,
  QuoteView,
} from "./billing-types";
import { getJob } from "./job-access";
import { notify, usersWithRoles } from "./notify";
import { totals as timeTotals } from "./time";
import { parseInput } from "./validate";
import type { JobView, OrganizationRecord, ServiceContext } from "./types";

// Invoices (FIN-03, EXP-04) and manual payments (FIN-05). Drafts have no number; issuing assigns the next number
// of the year (gap-free), the issue date (today in the organization's time zone) and the due date (issue date +
// payment terms), and emails the bill-to contact a link to the customer portal.

export async function listInvoices(ctx: ServiceContext, query: InvoiceListQuery) {
  assertCan(ctx.actor, "billing.manage");
  return ctx.store.billing.listInvoices(query);
}

/** Outstanding and overdue balances right now (the invoices page summary). */
export async function receivablesNow(ctx: ServiceContext) {
  assertCan(ctx.actor, "billing.manage");
  const org = await ctx.store.organization.get();
  return { currency: org.currency, ...(await ctx.store.billing.receivables(todayIn(org, ctx.now))) };
}

export async function getInvoice(ctx: ServiceContext, id: string): Promise<InvoiceView> {
  assertCan(ctx.actor, "billing.manage");
  const invoice = UUID.test(id) ? await ctx.store.billing.getInvoice(id) : null;
  if (!invoice) throw new NotFoundError("Invoice");
  return invoice;
}

/** Invoices of a job, newest first (JOB-05). */
export async function invoicesForJob(ctx: ServiceContext, jobId: string) {
  assertCan(ctx.actor, "billing.manage");
  return (await ctx.store.billing.listInvoices({ job: jobId, limit: 50 })).rows;
}

// ------------------------------------------------------------------ prefill from a job

export interface InvoicePrefill {
  job: JobView;
  /** The approved quote the job came from, whose lines replace the service line. */
  quote: Pick<QuoteView, "id" | "number" | "discountType" | "discountValue"> | null;
  customerId: string;
  siteId: string;
  contactId: string | null;
  discountType: QuoteView["discountType"];
  discountValue: number;
  lines: InvoiceLineInput[];
}

function serviceLine(
  st: { id: string; name: string; defaultPriceMinor: number; taxRateBps?: number | null },
  fallbackRate: number,
): InvoiceLineInput {
  return {
    kind: "service",
    description: st.name,
    quantity: 1,
    unit: null,
    unit_price_minor: st.defaultPriceMinor,
    tax_rate_bps: st.taxRateBps ?? fallbackRate,
    service_type_id: st.id,
    catalog_item_id: null,
    expense_request_id: null,
    unit_cost_minor: null,
    markup_bps: 0,
  };
}

/**
 * The lines of a new invoice for a job (FIN-03, EXP-04): the service at its price and tax (or the lines of the
 * approved quote the job came from), one labor line per technician for recorded work time rounded up to the
 * quarter hour at the labor rate, and every approved billable part or expense not billed yet, at cost plus its
 * markup.
 */
export async function prefillFromJob(ctx: ServiceContext, jobIdOrNumber: string): Promise<InvoicePrefill> {
  assertCan(ctx.actor, "billing.manage");
  const job = await getJob(ctx, jobIdOrNumber);
  const store = ctx.store;
  const org = await store.organization.get();
  const rate = defaultTaxRate(org.taxRates);
  const lines: InvoiceLineInput[] = [];

  const fromQuote = await store.billing.quoteForJob(job.id);
  const quote = fromQuote?.status === "approved" ? await store.billing.getQuote(fromQuote.id) : null;
  if (quote) {
    for (const l of quote.lines) {
      lines.push({
        kind: l.kind,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price_minor: l.unitPriceMinor,
        tax_rate_bps: l.taxRateBps,
        catalog_item_id: l.catalogItemId,
        service_type_id: l.serviceTypeId,
        expense_request_id: null,
        unit_cost_minor: null,
        markup_bps: 0,
      });
    }
  } else if (job.serviceTypeId) {
    const st = await store.serviceTypes.get(job.serviceTypeId);
    if (st) lines.push(serviceLine(st, rate));
  }

  const entries = (await store.timeEntries.listByJob(job.id)).filter((e) => e.kind === "work" && e.endedAt);
  for (const t of timeTotals(entries, ctx.now)) {
    const hours = billableHours(t.workMin);
    if (hours <= 0) continue;
    lines.push({
      kind: "labor",
      description: `Labor: ${t.member.name}`,
      quantity: hours,
      unit: "h",
      unit_price_minor: org.settings.billing.laborRateMinor,
      tax_rate_bps: rate,
      catalog_item_id: null,
      service_type_id: null,
      expense_request_id: null,
      unit_cost_minor: null,
      markup_bps: 0,
    });
  }

  const expenses = (await store.expenses.listByJob(job.id)).filter(
    (e) => e.status === "approved" && e.billable,
  );
  const billed = new Set(await store.billing.billedExpenseIds(expenses.map((e) => e.id)));
  for (const e of [...expenses].reverse()) {
    if (billed.has(e.id)) continue;
    lines.push({
      kind: e.kind === "part" ? "part" : "expense",
      description: e.item,
      quantity: e.quantity,
      unit: null,
      unit_price_minor: markedUp(e.unitCostMinor, e.markupBps),
      tax_rate_bps: rate,
      catalog_item_id: null,
      service_type_id: null,
      expense_request_id: e.id,
      unit_cost_minor: e.unitCostMinor,
      markup_bps: e.markupBps,
    });
  }

  const contacts = await store.customers.contacts(job.customerId);
  const contact = contacts.find((c) => c.isPrimary && c.email) ?? contacts.find((c) => c.email) ?? null;
  return {
    job,
    quote: quote
      ? {
          id: quote.id,
          number: quote.number,
          discountType: quote.discountType,
          discountValue: quote.discountValue,
        }
      : null,
    customerId: job.customerId,
    siteId: job.siteId,
    contactId: quote?.contactId ?? contact?.id ?? null,
    discountType: quote?.discountType ?? null,
    discountValue: quote?.discountValue ?? 0,
    lines,
  };
}

// ------------------------------------------------------------------ lines

/**
 * Turns line inputs into stored lines. Expense lines (EXP-04) must name an approved, billable request of the
 * invoice's job that isn't billed on another invoice (void ones don't count); their quantity and cost come from
 * the request and the unit price is cost × (1 + markup).
 */
async function invoiceLines(
  ctx: ServiceContext,
  lines: readonly InvoiceLineInput[],
  jobId: string | null,
  exceptInvoiceId?: string,
) {
  await checkLineRefs(ctx.store, lines);
  const expenseIds = lines.map((l) => l.expense_request_id).filter((x): x is string => Boolean(x));
  if (new Set(expenseIds).size !== expenseIds.length) {
    throw new ValidationError("A part or expense can only be billed once", [
      { path: "lines", message: "A part or expense appears twice" },
    ]);
  }
  const billed = new Set(
    expenseIds.length ? await ctx.store.billing.billedExpenseIds(expenseIds, exceptInvoiceId) : [],
  );
  const out = [];
  for (const [i, l] of lines.entries()) {
    const base = {
      kind: l.kind,
      catalogItemId: l.catalog_item_id ?? null,
      serviceTypeId: l.service_type_id ?? null,
      description: l.description,
      unit: l.unit ?? null,
      taxRateBps: l.tax_rate_bps,
    };
    if (!l.expense_request_id) {
      out.push({
        ...base,
        quantity: l.quantity,
        unitPriceMinor: l.unit_price_minor,
        expenseRequestId: null,
        unitCostMinor: l.unit_cost_minor ?? null,
        markupBps: 0,
      });
      continue;
    }
    const path = `lines.${i}.expense_request_id`;
    const e = await ctx.store.expenses.get(l.expense_request_id);
    if (!e || e.jobId !== jobId || e.status !== "approved" || !e.billable) {
      throw new ValidationError("Only approved parts and expenses of this job can be billed", [
        { path, message: "Not an approved part or expense of this job" },
      ]);
    }
    if (billed.has(e.id)) {
      throw new ConflictError(`${e.item} is already billed on another invoice`, { expense_request_id: e.id });
    }
    out.push({
      ...base,
      quantity: e.quantity,
      unitPriceMinor: markedUp(e.unitCostMinor, l.markup_bps),
      expenseRequestId: e.id,
      unitCostMinor: e.unitCostMinor,
      markupBps: l.markup_bps,
    });
  }
  return out;
}

function storedToLines(lines: readonly InvoiceLineRecord[]) {
  return lines.map(({ id: _id, position: _p, netMinor: _n, taxMinor: _t, ...rest }) => rest);
}

// ------------------------------------------------------------------ create and edit

/**
 * Creates a draft invoice: for a job (completed, FIN-03; lines prefilled from it unless given) or for a customer
 * with blank lines.
 */
export async function createInvoice(ctx: ServiceContext, raw: unknown): Promise<InvoiceView> {
  assertCan(ctx.actor, "billing.manage");
  const input = parseInput(invoiceCreateSchema, raw);
  const store = ctx.store;
  let prefill: InvoicePrefill | null = null;
  if (input.job_id) {
    prefill = await prefillFromJob(ctx, input.job_id);
    if (prefill.job.status !== "completed") {
      throw new ConflictError("A job can be invoiced once it's completed");
    }
    if (input.customer_id && input.customer_id !== prefill.customerId) {
      throw new ValidationError("The job belongs to another customer", [
        { path: "customer_id", message: "The job belongs to another customer" },
      ]);
    }
  }
  const customerId = prefill?.customerId ?? input.customer_id!;
  await requireCustomer(store, customerId);
  const siteId = input.site_id !== undefined ? input.site_id : (prefill?.siteId ?? null);
  await checkSite(store, customerId, siteId);
  let contactId = input.contact_id !== undefined ? input.contact_id : (prefill?.contactId ?? null);
  if (input.contact_id === undefined && !prefill) {
    contactId = (await recipientFor(store, customerId, null))?.id ?? null;
  }
  await checkContact(store, customerId, contactId);

  const jobId = prefill?.job.id ?? null;
  const lines = await invoiceLines(ctx, input.lines ?? prefill?.lines ?? [], jobId);
  const usePrefillDiscount = input.discount_type === undefined && prefill;
  const type = usePrefillDiscount ? prefill!.discountType : (input.discount_type ?? null);
  const value = type ? (usePrefillDiscount ? prefill!.discountValue : input.discount_value) : 0;
  const priced = priceLines(lines, { type, value });
  const org = await store.organization.get();
  const created = await store.billing.createInvoice(
    {
      customerId,
      siteId,
      jobId,
      quoteId: prefill?.quote?.id ?? null,
      contactId,
      currency: org.currency,
      discountType: type,
      discountValue: value,
      ...totalsPatch(priced.totals),
      notes: input.notes ?? null,
      createdBy: ctx.actor.userId,
    },
    priced.lines,
  );
  return (await store.billing.getInvoice(created.id))!;
}

/** Edits a draft invoice. Lines, when given, replace every line; totals are computed again. */
export async function updateInvoice(
  ctx: ServiceContext,
  id: string,
  raw: unknown,
  expectedVersion?: number,
): Promise<InvoiceView> {
  const input = parseInput(invoiceUpdateSchema, raw);
  const invoice = await getInvoice(ctx, id);
  if (expectedVersion !== undefined && invoice.version !== expectedVersion) {
    throw new PreconditionFailedError();
  }
  if (!isInvoiceEditable(invoice.status)) {
    throw new ConflictError("Only draft invoices can be edited");
  }
  const store = ctx.store;
  if (input.site_id !== undefined) await checkSite(store, invoice.customerId, input.site_id);
  if (input.contact_id !== undefined) await checkContact(store, invoice.customerId, input.contact_id);
  const patch: InvoicePatch = {};
  if (input.site_id !== undefined) patch.siteId = input.site_id;
  if (input.contact_id !== undefined) patch.contactId = input.contact_id;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  let lines: NewInvoiceLine[] | null = null;
  if (input.lines !== undefined || input.discount_type !== undefined || input.discount_value !== undefined) {
    const type = input.discount_type !== undefined ? input.discount_type : invoice.discountType;
    const value = type ? (input.discount_value ?? invoice.discountValue) : 0;
    const source = input.lines
      ? await invoiceLines(ctx, input.lines, invoice.jobId, invoice.id)
      : storedToLines(invoice.lines);
    const priced = priceLines(source, { type, value });
    Object.assign(patch, { discountType: type, discountValue: value, ...totalsPatch(priced.totals) });
    if (input.lines) lines = priced.lines;
  }
  const updated = await store.billing.updateInvoice(invoice.id, patch, {
    expectedVersion: invoice.version,
    fromStatuses: ["draft"],
  });
  if (!updated) throw new PreconditionFailedError();
  if (lines) await store.billing.replaceInvoiceLines(invoice.id, lines);
  return (await store.billing.getInvoice(invoice.id))!;
}

// ------------------------------------------------------------------ issue and send

async function emailInvoice(
  mailer: CustomerMailer | undefined,
  org: OrganizationRecord,
  invoice: InvoiceView,
  to: { name: string; email: string },
  locale: ReturnType<typeof customerLocale>,
) {
  await mailer?.send({
    kind: "invoice_sent",
    to: to.email,
    contactName: to.name,
    organizationName: org.name,
    locale,
    path: portalPath(org, "invoices", invoice.id),
    number: invoice.number!,
    total: moneyText(invoice.totalMinor, invoice.currency, locale),
    balance: moneyText(balanceOf(invoice), invoice.currency, locale),
    dueDate: dateText(invoice.dueDate, locale),
    paymentInstructions: org.settings.billing.paymentInstructions,
  });
}

/**
 * Issues a draft (number, issue date, due date) and emails it to the bill-to contact, or emails an issued, unpaid
 * invoice again. Issuing records the `invoiced` event on the job.
 */
export async function sendInvoice(ctx: BillingContext, id: string, raw: unknown = {}): Promise<InvoiceView> {
  const input = parseInput(documentSendSchema, raw ?? {});
  const invoice = await getInvoice(ctx, id);
  if (invoice.status !== "draft" && !isInvoiceOpen(invoice.status)) {
    throw new ConflictError(`A ${invoice.status} invoice can't be sent`);
  }
  const store = ctx.store;
  const to = await recipientFor(store, invoice.customerId, input.contact_id ?? invoice.contactId);
  if (!to) {
    throw new ValidationError("Choose a contact with an email address", [
      { path: "contact_id", message: "Choose a contact with an email address" },
    ]);
  }
  const org = await store.organization.get();
  const customer = await store.customers.get(invoice.customerId);
  const locale = customerLocale(customer, org);

  if (invoice.status !== "draft") {
    const resent = await store.billing.updateInvoice(
      invoice.id,
      { sentAt: ctx.now, contactId: to.id },
      { expectedVersion: invoice.version },
    );
    if (!resent) throw new PreconditionFailedError();
    const view = (await store.billing.getInvoice(invoice.id))!;
    await emailInvoice(ctx.customerMailer, org, view, to, locale);
    return view;
  }

  if (invoice.lines.length === 0 || invoice.totalMinor <= 0) {
    throw new ValidationError("The invoice needs at least one line and a total above zero", [
      { path: "lines", message: "Add at least one line with a price" },
    ]);
  }
  // Another invoice may have billed the same parts since this draft was saved (EXP-04).
  const expenseIds = invoice.lines.map((l) => l.expenseRequestId).filter((x): x is string => Boolean(x));
  if (expenseIds.length && (await store.billing.billedExpenseIds(expenseIds, invoice.id)).length) {
    throw new ConflictError("A part or expense on this invoice is already billed on another invoice");
  }
  const today = todayIn(org, ctx.now);
  const year = Number(today.slice(0, 4));
  const n = await store.billing.nextCounter(`invoice:${year}`);
  const number = formatYearlyNumber(org.settings.billing.invoicePrefix, year, n);
  const issued = await store.billing.updateInvoice(
    invoice.id,
    {
      status: "sent",
      number,
      issueDate: today,
      dueDate: addDays(today, org.settings.billing.paymentTermsDays),
      sentAt: ctx.now,
      contactId: to.id,
    },
    { expectedVersion: invoice.version, fromStatuses: ["draft"] },
  );
  if (!issued) throw new PreconditionFailedError();
  if (invoice.jobId) {
    await store.jobs.addEvent({
      jobId: invoice.jobId,
      type: "invoiced",
      fromStatus: null,
      toStatus: null,
      actorUserId: ctx.actor.userId,
      payload: {
        invoice_id: invoice.id,
        invoice_number: number,
        total_minor: invoice.totalMinor,
        currency: invoice.currency,
      },
    });
  }
  const view = (await store.billing.getInvoice(invoice.id))!;
  await emailInvoice(ctx.customerMailer, org, view, to, locale);
  return view;
}

/**
 * Voids an invoice with a reason. Drafts and issued invoices without payments can be voided; an invoice with
 * payments can't (its payments would have to be refunded first). Its parts and expenses can be billed again.
 */
export async function voidInvoice(ctx: ServiceContext, id: string, raw: unknown): Promise<InvoiceView> {
  const input = parseInput(invoiceVoidSchema, raw);
  const invoice = await getInvoice(ctx, id);
  const blocker = voidBlocker(invoice);
  if (blocker) {
    throw new ConflictError(
      blocker === "already_void"
        ? "This invoice is already void"
        : blocker === "paid"
          ? "A paid invoice can't be voided"
          : "An invoice with payments can't be voided",
      { reason: blocker },
    );
  }
  const updated = await ctx.store.billing.updateInvoice(
    invoice.id,
    { status: "void", voidedAt: ctx.now, voidReason: input.reason },
    { expectedVersion: invoice.version, fromStatuses: ["draft", "sent", "overdue"] },
  );
  if (!updated) throw new PreconditionFailedError();
  return (await ctx.store.billing.getInvoice(invoice.id))!;
}

// ------------------------------------------------------------------ payments (FIN-05)

export interface PaymentInput {
  amountMinor: number;
  method: PaymentMethod;
  /** "manual", or the online provider that confirmed it. */
  provider: string;
  /** The provider's id for the payment: a second webhook with the same id changes nothing. */
  providerRef: string | null;
  reference: string | null;
  note: string | null;
  paidAt: Date;
}

/** Staff record a payment made by cash, bank transfer or a card taken elsewhere. */
export async function recordPayment(
  ctx: BillingContext,
  invoiceId: string,
  raw: unknown,
): Promise<InvoiceView> {
  const input = parseInput(paymentCreateSchema, raw);
  const invoice = await getInvoice(ctx, invoiceId);
  const paidAt = input.paid_at ? new Date(input.paid_at) : ctx.now;
  if (paidAt.getTime() > ctx.now.getTime() + 60_000) {
    throw new ValidationError("A payment can't be in the future", [
      { path: "paid_at", message: "Can't be in the future" },
    ]);
  }
  return applyPayment(
    ctx,
    invoice,
    {
      amountMinor: input.amount_minor,
      method: input.method,
      provider: "manual",
      providerRef: null,
      reference: input.reference ?? null,
      note: input.note ?? null,
      paidAt,
    },
    { userId: ctx.actor.userId, name: ctx.actor.name },
  );
}

/**
 * Adds a payment to an issued invoice: at most the balance; the invoice becomes paid when payments cover the
 * total. Owners are notified (never the person who recorded it) and the bill-to contact gets a receipt. The online
 * payment webhook calls this with its provider and reference; a repeated reference changes nothing.
 */
export async function applyPayment(
  deps: BillingDeps & Pick<BillingContext, "customerMailer">,
  invoice: InvoiceView,
  payment: PaymentInput,
  by: { userId: string | null; name: string | null },
): Promise<InvoiceView> {
  const { store } = deps;
  if (payment.providerRef && (await store.billing.findPayment(payment.provider, payment.providerRef))) {
    return (await store.billing.getInvoice(invoice.id))!;
  }
  if (!isInvoiceOpen(invoice.status)) {
    throw new ConflictError(
      invoice.status === "draft"
        ? "Issue the invoice before recording a payment"
        : `A ${invoice.status} invoice can't take payments`,
    );
  }
  const balance = balanceOf(invoice);
  const org = await store.organization.get();
  if (payment.amountMinor > balance) {
    throw new ValidationError("The payment is more than the balance", [
      {
        path: "amount_minor",
        message: `At most the balance of ${moneyText(balance, invoice.currency, "en")}`,
      },
    ]);
  }
  const applied = await store.billing.applyPaymentToInvoice(invoice.id, payment.amountMinor, payment.paidAt);
  if (!applied) throw new ConflictError("The invoice changed meanwhile. Reload it and try again.");
  await store.billing.addPayment({
    invoiceId: invoice.id,
    amountMinor: payment.amountMinor,
    currency: invoice.currency,
    method: payment.method,
    provider: payment.provider,
    providerRef: payment.providerRef,
    reference: payment.reference,
    note: payment.note,
    paidAt: payment.paidAt,
    recordedByUserId: by.userId,
  });

  await notify(
    { store, mailer: deps.mailer },
    {
      event: "payment_received",
      userIds: await usersWithRoles(store, ["owner"]),
      exceptUserId: by.userId,
      payload: {
        invoice_id: invoice.id,
        invoice_number: invoice.number ?? undefined,
        customer_name: invoice.customer.name,
        amount: moneyText(payment.amountMinor, invoice.currency, "en"),
        ...(by.name ? { actor_name: by.name } : {}),
      },
    },
  );
  const to = await recipientFor(store, invoice.customerId, invoice.contactId);
  if (to && deps.customerMailer) {
    const customer = await store.customers.get(invoice.customerId);
    const locale = customerLocale(customer, org);
    await deps.customerMailer.send({
      kind: "payment_receipt",
      to: to.email,
      contactName: to.name,
      organizationName: org.name,
      locale,
      path: portalPath(org, "invoices", invoice.id),
      number: invoice.number!,
      amount: moneyText(payment.amountMinor, invoice.currency, locale),
      balance: moneyText(applied.totalMinor - applied.amountPaidMinor, invoice.currency, locale),
      paidAt: dateText(todayIn(org, payment.paidAt), locale)!,
      method: payment.method,
      paidInFull: applied.amountPaidMinor >= applied.totalMinor,
    });
  }
  return (await store.billing.getInvoice(invoice.id))!;
}
