import "server-only";
import {
  balanceOf,
  customerLocale,
  dates,
  formatJobNumber,
  type InvoiceView,
  type OrganizationRecord,
  type PartyRefs,
  type QuoteLineRecord,
  type QuoteView,
  type ServiceContext,
} from "@fieldops/core";
import type {
  DocumentBrand,
  DocumentLine,
  DocumentParty,
  InvoiceDocument,
  QuoteDocument,
} from "@fieldops/documents";
import type { Address } from "@fieldops/shared";

// PDF view models for quotes and invoices (FIN-04), built in one place so the API routes, the customer portal and
// the documents slice share them. Renderers (`renderQuotePdf`, `renderInvoicePdf`) only see these plain objects.

/** Staff routes pass their service context; the customer portal passes its own store and clock. */
type DocumentContext = Pick<ServiceContext, "store" | "now">;

function addressLines(a: Address | null | undefined): string[] {
  if (!a) return [];
  return [
    a.line1,
    a.line2,
    [a.postal_code, a.city].filter(Boolean).join(" "),
    [a.region, a.country].filter(Boolean).join(", "),
  ].filter((l): l is string => Boolean(l));
}

export function documentBrand(org: OrganizationRecord): DocumentBrand {
  return {
    name: org.name,
    logo: null,
    brandColor: org.brandColor,
    addressLines: addressLines(org.address),
    email: null,
    phone: null,
    timeZone: org.timezone,
  };
}

function parties(doc: PartyRefs, billingAddress: Address | null) {
  const customer: DocumentParty = {
    name: doc.customer.name,
    lines: [
      ...(doc.contact ? [doc.contact.name] : []),
      ...addressLines(billingAddress ?? doc.site?.address),
      ...(doc.contact?.email ? [doc.contact.email] : []),
    ],
  };
  const site: DocumentParty | null = doc.site
    ? { name: doc.site.label, lines: addressLines(doc.site.address) }
    : null;
  return { customer, site };
}

const lines = (rows: readonly QuoteLineRecord[]): DocumentLine[] =>
  rows.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unitPriceMinor: l.unitPriceMinor,
    taxRateBps: l.taxRateBps,
    netMinor: l.netMinor,
  }));

export async function quoteDocument(ctx: DocumentContext, quote: QuoteView): Promise<QuoteDocument> {
  const org = await ctx.store.organization.get();
  const customer = await ctx.store.customers.get(quote.customerId);
  const p = parties(quote, customer?.billingAddress ?? null);
  return {
    locale: customerLocale(customer, org),
    currency: quote.currency,
    brand: documentBrand(org),
    number: quote.number,
    title: quote.title,
    customer: p.customer,
    site: p.site,
    issuedOn: dates.localDateString(quote.sentAt ?? quote.createdAt, org.timezone),
    validUntil: quote.validUntil,
    notes: quote.notes,
    lines: lines(quote.lines),
    totals: {
      subtotalMinor: quote.subtotalMinor,
      discountMinor: quote.discountMinor,
      taxMinor: quote.taxMinor,
      totalMinor: quote.totalMinor,
    },
  };
}

export async function invoiceDocument(ctx: DocumentContext, invoice: InvoiceView): Promise<InvoiceDocument> {
  const org = await ctx.store.organization.get();
  const customer = await ctx.store.customers.get(invoice.customerId);
  const p = parties(invoice, customer?.billingAddress ?? null);
  return {
    locale: customerLocale(customer, org),
    currency: invoice.currency,
    brand: documentBrand(org),
    // Drafts have no number yet; the PDF is a preview.
    number: invoice.number ?? "DRAFT",
    status: invoice.status,
    billTo: p.customer,
    site: p.site,
    jobNumber: invoice.job ? formatJobNumber(invoice.job.number) : null,
    issueDate: invoice.issueDate ?? dates.localDateString(ctx.now, org.timezone),
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    paymentInstructions: org.settings.billing.paymentInstructions,
    lines: lines(invoice.lines),
    totals: {
      subtotalMinor: invoice.subtotalMinor,
      discountMinor: invoice.discountMinor,
      taxMinor: invoice.taxMinor,
      totalMinor: invoice.totalMinor,
      amountPaidMinor: invoice.amountPaidMinor,
      balanceMinor: balanceOf(invoice),
    },
  };
}
