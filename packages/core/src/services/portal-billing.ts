import {
  quoteDecisionSchema,
  type Currency,
  type InvoiceStatus,
  type PaymentMethod,
  type QuoteStatus,
} from "@fieldops/shared";
import { balanceOf, isInvoiceOpen, isQuoteExpired } from "../domain/billing";
import { NotFoundError } from "../domain/errors";
import { UUID, todayIn } from "./billing-common";
import type { InvoiceView, QuoteLineRecord, QuoteView } from "./billing-types";
import type { PortalActor, PortalContext } from "./portal-types";
import { applyQuoteDecision } from "./quotes";
import { parseInput } from "./validate";
import type { Store } from "./types";

// The customer's quotes and invoices in the portal (POR-04). Only what was sent to the customer (never drafts)
// and only their own: another customer's document is "not found". What leaves here is what the customer may
// see: lines and totals, never costs, markups, internal ids of staff or payment notes.

/** Statuses the customer sees: a sent quote past its validity date shows as expired before the worker runs. */
const QUOTE_SENT: QuoteStatus[] = ["sent", "approved", "declined", "expired"];
const INVOICE_ISSUED: InvoiceStatus[] = ["sent", "overdue", "paid", "void"];

export interface PortalQuoteRow {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  currency: Currency;
  totalMinor: number;
  validUntil: string | null;
  sentAt: Date | null;
  decidedAt: Date | null;
}

export interface PortalQuote extends PortalQuoteRow {
  notes: string | null;
  site: { label: string; line1: string; city: string } | null;
  lines: QuoteLineRecord[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  declineReason: string | null;
  /** The job an approval created. */
  job: { number: number } | null;
  /** Sent and still valid: the customer can approve or decline. */
  canDecide: boolean;
}

export interface PortalInvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: Currency;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  issueDate: string | null;
  dueDate: string | null;
  paidAt: Date | null;
}

export interface PortalPayment {
  id: string;
  amountMinor: number;
  method: PaymentMethod;
  /** "manual", or the online provider that confirmed it. */
  provider: string;
  paidAt: Date;
}

export interface PortalInvoice extends PortalInvoiceRow {
  notes: string | null;
  site: { label: string; line1: string; city: string } | null;
  job: { number: number; title: string } | null;
  lines: QuoteLineRecord[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  payments: PortalPayment[];
  /** Issued, not settled or void, with a balance: the customer can pay it. */
  canPay: boolean;
  /** The organization's bank transfer instructions (FIN-05 without online payments). */
  paymentInstructions: string | null;
}

const site = (s: QuoteView["site"]) =>
  s ? { label: s.label, line1: s.address.line1, city: s.address.city } : null;

/** Lines without what the business keeps to itself (EXP-04 cost and markup). */
const customerLines = (lines: readonly QuoteLineRecord[]): QuoteLineRecord[] =>
  lines.map((l) => ({
    id: l.id,
    position: l.position,
    kind: l.kind,
    catalogItemId: l.catalogItemId,
    serviceTypeId: l.serviceTypeId,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unitPriceMinor: l.unitPriceMinor,
    taxRateBps: l.taxRateBps,
    netMinor: l.netMinor,
    taxMinor: l.taxMinor,
  }));

// ------------------------------------------------------------------ quotes

function quoteRow(q: Omit<QuoteView, "lines">, today: string): PortalQuoteRow {
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    status: isQuoteExpired(q, today) ? "expired" : q.status,
    currency: q.currency,
    totalMinor: q.totalMinor,
    validUntil: q.validUntil,
    sentAt: q.sentAt,
    decidedAt: q.decidedAt,
  };
}

/** A quote sent to this customer, with everything the PDF needs; otherwise "not found". */
export async function portalQuoteView(store: Store, portal: PortalActor, id: string): Promise<QuoteView> {
  const quote = UUID.test(id) ? await store.billing.getQuote(id) : null;
  if (!quote || quote.customerId !== portal.customerId || !QUOTE_SENT.includes(quote.status)) {
    throw new NotFoundError("Quote");
  }
  return quote;
}

async function toPortalQuote(store: Store, now: Date, quote: QuoteView): Promise<PortalQuote> {
  const row = quoteRow(quote, todayIn(await store.organization.get(), now));
  return {
    ...row,
    notes: quote.notes,
    site: site(quote.site),
    lines: customerLines(quote.lines),
    subtotalMinor: quote.subtotalMinor,
    discountMinor: quote.discountMinor,
    taxMinor: quote.taxMinor,
    declineReason: quote.declineReason,
    job: quote.job ? { number: quote.job.number } : null,
    canDecide: row.status === "sent",
  };
}

/** The customer's quotes, newest first. */
export async function listPortalQuotes(ctx: PortalContext): Promise<PortalQuoteRow[]> {
  const today = todayIn(await ctx.store.organization.get(), ctx.now);
  const page = await ctx.store.billing.listQuotes({
    customer: ctx.portal.customerId,
    status: QUOTE_SENT,
    limit: 100,
  });
  return page.rows.map((q) => quoteRow(q, today));
}

export async function getPortalQuote(ctx: PortalContext, id: string): Promise<PortalQuote> {
  return toPortalQuote(ctx.store, ctx.now, await portalQuoteView(ctx.store, ctx.portal, id));
}

/** The customer opened the quote (the first time is kept). */
export async function markPortalQuoteViewed(ctx: PortalContext, id: string): Promise<void> {
  const quote = await portalQuoteView(ctx.store, ctx.portal, id);
  if (!quote.viewedAt) await ctx.store.billing.markViewed("quote", quote.id, ctx.now);
}

/**
 * The customer approves or declines (with a reason) a sent quote. An approval creates a New job, like a decision
 * staff record; the office is notified with the contact as the one who decided.
 */
export async function decidePortalQuote(ctx: PortalContext, id: string, raw: unknown): Promise<PortalQuote> {
  const input = parseInput(quoteDecisionSchema, raw);
  const quote = await portalQuoteView(ctx.store, ctx.portal, id);
  const decided = await applyQuoteDecision(
    { store: ctx.store, now: ctx.now, mailer: ctx.mailer },
    quote,
    input,
    {
      kind: "contact",
      contactId: ctx.portal.contactId,
      name: ctx.portal.contactName,
    },
  );
  return toPortalQuote(ctx.store, ctx.now, decided);
}

// ------------------------------------------------------------------ invoices

function invoiceRow(i: Omit<InvoiceView, "lines" | "payments">): PortalInvoiceRow {
  return {
    id: i.id,
    number: i.number!,
    status: i.status,
    currency: i.currency,
    totalMinor: i.totalMinor,
    amountPaidMinor: i.amountPaidMinor,
    balanceMinor: i.status === "void" ? 0 : balanceOf(i),
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    paidAt: i.paidAt,
  };
}

/** An invoice issued to this customer, with everything the PDF needs; otherwise "not found". */
export async function portalInvoiceView(store: Store, portal: PortalActor, id: string): Promise<InvoiceView> {
  const invoice = UUID.test(id) ? await store.billing.getInvoice(id) : null;
  if (
    !invoice ||
    invoice.customerId !== portal.customerId ||
    !invoice.number ||
    !INVOICE_ISSUED.includes(invoice.status)
  ) {
    throw new NotFoundError("Invoice");
  }
  return invoice;
}

/** The customer's issued invoices, newest first. */
export async function listPortalInvoices(ctx: PortalContext): Promise<PortalInvoiceRow[]> {
  const page = await ctx.store.billing.listInvoices({
    customer: ctx.portal.customerId,
    status: INVOICE_ISSUED,
    limit: 100,
  });
  return page.rows.filter((i) => i.number).map(invoiceRow);
}

export async function getPortalInvoice(ctx: PortalContext, id: string): Promise<PortalInvoice> {
  const invoice = await portalInvoiceView(ctx.store, ctx.portal, id);
  const org = await ctx.store.organization.get();
  const row = invoiceRow(invoice);
  return {
    ...row,
    notes: invoice.notes,
    site: site(invoice.site),
    job: invoice.job ? { number: invoice.job.number, title: invoice.job.title } : null,
    lines: customerLines(invoice.lines),
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    taxMinor: invoice.taxMinor,
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amountMinor: p.amountMinor,
      method: p.method,
      provider: p.provider,
      paidAt: p.paidAt,
    })),
    canPay: isInvoiceOpen(invoice.status) && row.balanceMinor > 0,
    paymentInstructions: org.settings.billing.paymentInstructions,
  };
}

/** The customer opened the invoice (the first time is kept). */
export async function markPortalInvoiceViewed(ctx: PortalContext, id: string): Promise<void> {
  const invoice = await portalInvoiceView(ctx.store, ctx.portal, id);
  if (!invoice.viewedAt) await ctx.store.billing.markViewed("invoice", invoice.id, ctx.now);
}

// ------------------------------------------------------------------ portal home

export interface PortalBillingSummary {
  /** Quotes waiting for the customer's decision. */
  quotes: PortalQuoteRow[];
  /** Invoices with a balance to pay, overdue first. */
  invoices: PortalInvoiceRow[];
}

export async function portalBillingSummary(ctx: PortalContext): Promise<PortalBillingSummary> {
  const [quotes, invoices] = await Promise.all([listPortalQuotes(ctx), listPortalInvoices(ctx)]);
  return {
    quotes: quotes.filter((q) => q.status === "sent"),
    invoices: invoices
      .filter((i) => isInvoiceOpen(i.status) && i.balanceMinor > 0)
      .sort((a, b) => Number(b.status === "overdue") - Number(a.status === "overdue")),
  };
}
