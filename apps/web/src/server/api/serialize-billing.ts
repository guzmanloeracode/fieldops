import {
  balanceOf,
  formatJobNumber,
  type CatalogItemRecord,
  type InvoiceLineRecord,
  type InvoiceListRow,
  type InvoiceView,
  type PaymentRecord,
  type QuoteLineRecord,
  type QuoteListRow,
  type QuoteView,
} from "@fieldops/core";
import type {
  CatalogItemDto,
  InvoiceDto,
  InvoiceSummaryDto,
  PaymentDto,
  QuoteDto,
  QuoteSummaryDto,
} from "@fieldops/shared";

// Public snake_case representations of the catalog, quotes, invoices and payments (§17.2).

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toCatalogItemDto(c: CatalogItemRecord): CatalogItemDto {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    description: c.description,
    sku: c.sku,
    unit: c.unit,
    unit_price_minor: c.unitPriceMinor,
    unit_cost_minor: c.unitCostMinor,
    currency: c.currency,
    tax_rate_bps: c.taxRateBps,
    active: c.active,
  };
}

function lineDto(l: QuoteLineRecord) {
  return {
    id: l.id,
    position: l.position,
    kind: l.kind,
    catalog_item_id: l.catalogItemId,
    service_type_id: l.serviceTypeId,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unit_price_minor: l.unitPriceMinor,
    tax_rate_bps: l.taxRateBps,
    net_minor: l.netMinor,
    tax_minor: l.taxMinor,
  };
}

const invoiceLineDto = (l: InvoiceLineRecord) => ({
  ...lineDto(l),
  expense_request_id: l.expenseRequestId,
  unit_cost_minor: l.unitCostMinor,
  markup_bps: l.markupBps,
});

function totals(d: QuoteListRow | InvoiceListRow) {
  return {
    currency: d.currency,
    discount_type: d.discountType,
    discount_value: d.discountValue,
    subtotal_minor: d.subtotalMinor,
    discount_minor: d.discountMinor,
    tax_minor: d.taxMinor,
    total_minor: d.totalMinor,
  };
}

function parties(d: QuoteListRow | InvoiceListRow) {
  return {
    customer: d.customer,
    site: d.site ? { id: d.site.id, label: d.site.label } : null,
    contact: d.contact,
  };
}

export function toQuoteSummaryDto(q: QuoteListRow): QuoteSummaryDto {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    title: q.title,
    ...parties(q),
    service_type: q.serviceType,
    job: q.job ? { id: q.job.id, number: formatJobNumber(q.job.number) } : null,
    ...totals(q),
    valid_until: q.validUntil,
    sent_at: iso(q.sentAt),
    viewed_at: iso(q.viewedAt),
    decided_at: iso(q.decidedAt),
    decline_reason: q.declineReason,
    version: q.version,
    created_at: q.createdAt.toISOString(),
    updated_at: q.updatedAt.toISOString(),
  };
}

export function toQuoteDto(q: QuoteView): QuoteDto {
  return { ...toQuoteSummaryDto(q), notes: q.notes, lines: q.lines.map(lineDto) };
}

export function toPaymentDto(p: PaymentRecord): PaymentDto {
  return {
    id: p.id,
    invoice_id: p.invoiceId,
    amount_minor: p.amountMinor,
    currency: p.currency,
    method: p.method,
    provider: p.provider,
    reference: p.reference,
    note: p.note,
    paid_at: p.paidAt.toISOString(),
    recorded_by: p.recordedBy,
    created_at: p.createdAt.toISOString(),
  };
}

export function toInvoiceSummaryDto(i: InvoiceListRow): InvoiceSummaryDto {
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    ...parties(i),
    job: i.job ? { id: i.job.id, number: formatJobNumber(i.job.number), title: i.job.title } : null,
    quote: i.quote,
    ...totals(i),
    amount_paid_minor: i.amountPaidMinor,
    balance_minor: i.status === "void" ? 0 : balanceOf(i),
    issue_date: i.issueDate,
    due_date: i.dueDate,
    sent_at: iso(i.sentAt),
    paid_at: iso(i.paidAt),
    voided_at: iso(i.voidedAt),
    void_reason: i.voidReason,
    version: i.version,
    created_at: i.createdAt.toISOString(),
    updated_at: i.updatedAt.toISOString(),
  };
}

export function toInvoiceDto(i: InvoiceView): InvoiceDto {
  return {
    ...toInvoiceSummaryDto(i),
    notes: i.notes,
    lines: i.lines.map(invoiceLineDto),
    payments: i.payments.map(toPaymentDto),
  };
}
