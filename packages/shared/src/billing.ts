import { z } from "zod";
import {
  CATALOG_ITEM_KINDS,
  DISCOUNT_TYPES,
  INVOICE_STATUSES,
  LINE_KINDS,
  PAYMENT_METHODS,
  QUOTE_STATUSES,
} from "./constants";
import { csvEnum, isoDateTime, optionalText, queryBool, trimmed, ts } from "./fields";
import { currencySchema } from "./schemas";

// 0.4 Get paid: the catalog (FIN-01), quotes (FIN-02), invoices (FIN-03, EXP-04), payments (FIN-05), reminders
// (FIN-06) and billing settings. Money is integer minor units plus the organization's currency (FIN-07, ADR 009).

/** Largest unit price or amount accepted on a line: 100,000,000.00 in either currency. */
export const MAX_UNIT_PRICE_MINOR = 100_000_000_00;
/** Lines per quote or invoice. */
export const MAX_DOCUMENT_LINES = 100;
/** Markup on billed parts and expenses, in basis points (EXP-04): up to 1000%. */
export const MAX_MARKUP_BPS = 100_000;

export const lineKindSchema = z.enum(LINE_KINDS).meta({ id: "LineKind" });
export const quoteStatusSchema = z.enum(QUOTE_STATUSES).meta({ id: "QuoteStatus" });
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES).meta({ id: "InvoiceStatus" });
export const paymentMethodSchema = z.enum(PAYMENT_METHODS).meta({ id: "PaymentMethod" });
export const discountTypeSchema = z.enum(DISCOUNT_TYPES).meta({ id: "DiscountType" });

const quantity = z
  .number()
  .positive()
  .max(100_000)
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "At most two decimals");
const bps = z.number().int().min(0).max(10_000);
const price = z.number().int().min(0).max(MAX_UNIT_PRICE_MINOR);

/** A line on a quote: a service, labor, a part, an expense or a fee, with its own tax rate. */
export const quoteLineInputSchema = z
  .object({
    kind: lineKindSchema,
    description: trimmed(500).min(1),
    quantity,
    unit: optionalText(20),
    unit_price_minor: price,
    tax_rate_bps: bps,
    catalog_item_id: z.uuid().nullable().optional(),
    service_type_id: z.uuid().nullable().optional(),
  })
  .meta({ id: "QuoteLineInput" });
export type QuoteLineInput = z.output<typeof quoteLineInputSchema>;

/**
 * A line on an invoice. A line billing an approved part or expense (EXP-04) names it in `expense_request_id`; its
 * quantity and unit cost come from the request and the unit price is cost × (1 + markup).
 */
export const invoiceLineInputSchema = quoteLineInputSchema
  .extend({
    expense_request_id: z.uuid().nullable().optional(),
    unit_cost_minor: price.nullable().optional(),
    markup_bps: z.number().int().min(0).max(MAX_MARKUP_BPS).default(0),
  })
  .meta({ id: "InvoiceLineInput" });
export type InvoiceLineInput = z.output<typeof invoiceLineInputSchema>;

const discountFields = {
  /** percent (value in basis points) or amount (value in minor units); null for no discount. */
  discount_type: discountTypeSchema.nullable().optional(),
  discount_value: price.default(0),
};
const discountRule = (v: { discount_type?: string | null; discount_value?: number }) =>
  v.discount_type !== "percent" || (v.discount_value ?? 0) <= 10_000;
const discountIssue = { message: "A percentage can't exceed 100%", path: ["discount_value"] };

export const quoteCreateSchema = z
  .object({
    customer_id: z.uuid(),
    site_id: z.uuid(),
    /** Who receives the quote and may approve it. */
    contact_id: z.uuid().nullable().optional(),
    /** Used for the job an approval creates. */
    service_type_id: z.uuid().nullable().optional(),
    title: trimmed(200).min(1),
    /** Customer-facing message. */
    notes: optionalText(4000),
    /** Defaults to today plus the organization's quote validity. */
    valid_until: z.iso.date().optional(),
    ...discountFields,
    lines: z.array(quoteLineInputSchema).max(MAX_DOCUMENT_LINES).default([]),
  })
  .refine(discountRule, discountIssue)
  .meta({ id: "QuoteCreate" });
export type QuoteCreate = z.output<typeof quoteCreateSchema>;

/** Changes to a draft quote. Lines, when given, replace every line. */
export const quoteUpdateSchema = z
  .object({
    site_id: z.uuid(),
    contact_id: z.uuid().nullable(),
    service_type_id: z.uuid().nullable(),
    title: trimmed(200).min(1),
    notes: optionalText(4000),
    valid_until: z.iso.date(),
    discount_type: discountTypeSchema.nullable(),
    discount_value: price,
    lines: z.array(quoteLineInputSchema).max(MAX_DOCUMENT_LINES),
  })
  .partial()
  .refine(discountRule, discountIssue)
  .meta({ id: "QuoteUpdate" });
export type QuoteUpdate = z.output<typeof quoteUpdateSchema>;

/** Sends a quote or invoice by email. Without `contact_id` it goes to the document's contact. */
export const documentSendSchema = z.object({ contact_id: z.uuid().optional() }).meta({ id: "DocumentSend" });
export type DocumentSend = z.output<typeof documentSendSchema>;

/** The customer's decision on a sent quote, recorded in the portal or by staff on their behalf. */
export const quoteDecisionSchema = z
  .object({
    decision: z.enum(["approve", "decline"]),
    reason: optionalText(1000),
  })
  .refine((v) => v.decision === "approve" || Boolean(v.reason), {
    message: "Say why the customer declined",
    path: ["reason"],
  })
  .meta({ id: "QuoteDecision" });
export type QuoteDecision = z.output<typeof quoteDecisionSchema>;

export const quoteListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csvEnum(QUOTE_STATUSES).optional(),
  customer: z.uuid().optional(),
  job: z.uuid().optional(),
  /** Created on or after / before, local dates. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type QuoteListQuery = z.output<typeof quoteListQuerySchema>;

/**
 * A new invoice. With `job_id` and no `lines`, the lines are prefilled from the job: its service (or the approved
 * quote it came from), recorded labor and approved parts and expenses not billed yet. Without a job, `customer_id`
 * is required.
 */
export const invoiceCreateSchema = z
  .object({
    job_id: z.uuid().optional(),
    customer_id: z.uuid().optional(),
    site_id: z.uuid().nullable().optional(),
    /** Bill-to contact: receives the invoice and reminders. */
    contact_id: z.uuid().nullable().optional(),
    notes: optionalText(4000),
    ...discountFields,
    lines: z.array(invoiceLineInputSchema).max(MAX_DOCUMENT_LINES).optional(),
  })
  .refine((v) => Boolean(v.job_id || v.customer_id), {
    message: "Choose a customer or a job",
    path: ["customer_id"],
  })
  .refine(discountRule, discountIssue)
  .meta({ id: "InvoiceCreate" });
export type InvoiceCreate = z.output<typeof invoiceCreateSchema>;

/** Changes to a draft invoice. Lines, when given, replace every line. */
export const invoiceUpdateSchema = z
  .object({
    site_id: z.uuid().nullable(),
    contact_id: z.uuid().nullable(),
    notes: optionalText(4000),
    discount_type: discountTypeSchema.nullable(),
    discount_value: price,
    lines: z.array(invoiceLineInputSchema).max(MAX_DOCUMENT_LINES),
  })
  .partial()
  .refine(discountRule, discountIssue)
  .meta({ id: "InvoiceUpdate" });
export type InvoiceUpdate = z.output<typeof invoiceUpdateSchema>;

export const invoiceVoidSchema = z
  .object({ reason: trimmed(500).min(3, "Say why the invoice is void") })
  .meta({ id: "InvoiceVoid" });
export type InvoiceVoid = z.output<typeof invoiceVoidSchema>;

/** A payment recorded by hand: cash, bank transfer or a card taken elsewhere (FIN-05). */
export const paymentCreateSchema = z
  .object({
    amount_minor: z
      .number()
      .int()
      .positive()
      .max(MAX_UNIT_PRICE_MINOR * 100),
    method: paymentMethodSchema,
    /** Bank reference or receipt number. */
    reference: optionalText(120),
    note: optionalText(500),
    /** Defaults to now. */
    paid_at: isoDateTime.optional(),
  })
  .meta({ id: "PaymentCreate" });
export type PaymentCreate = z.output<typeof paymentCreateSchema>;

export const invoiceListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csvEnum(INVOICE_STATUSES).optional(),
  customer: z.uuid().optional(),
  job: z.uuid().optional(),
  /** Issue date range (local dates); drafts have none and are left out when a range is set. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type InvoiceListQuery = z.output<typeof invoiceListQuerySchema>;

// ---------------------------------------------------------------- catalog (FIN-01)

export const catalogItemInputSchema = z
  .object({
    kind: z.enum(CATALOG_ITEM_KINDS).default("part"),
    name: trimmed(160).min(1),
    description: optionalText(1000),
    sku: optionalText(60),
    unit: trimmed(20).min(1).default("each"),
    unit_price_minor: price,
    unit_cost_minor: price.nullable().optional(),
    /** One of the organization's tax rates; null uses the default rate. */
    tax_rate_bps: bps.nullable().optional(),
    active: z.boolean().default(true),
  })
  .meta({ id: "CatalogItemInput" });
export type CatalogItemInput = z.output<typeof catalogItemInputSchema>;

export const catalogItemUpdateSchema = z
  .object({
    kind: z.enum(CATALOG_ITEM_KINDS),
    name: trimmed(160).min(1),
    description: optionalText(1000),
    sku: optionalText(60),
    unit: trimmed(20).min(1),
    unit_price_minor: price,
    unit_cost_minor: price.nullable(),
    tax_rate_bps: bps.nullable(),
    active: z.boolean(),
  })
  .partial()
  .meta({ id: "CatalogItemUpdate" });
export type CatalogItemUpdate = z.output<typeof catalogItemUpdateSchema>;

export const catalogQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(CATALOG_ITEM_KINDS).optional(),
  include_inactive: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CatalogQuery = z.output<typeof catalogQuerySchema>;

// ---------------------------------------------------------------- settings

const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,10}$/, "1–10 letters or digits");

/** Billing settings (FIN-02, FIN-03, FIN-06). Owners and admins. */
export const billingSettingsSchema = z
  .object({
    payment_terms_days: z.number().int().min(0).max(365),
    quote_validity_days: z.number().int().min(1).max(365),
    /** Labor billed per hour of recorded work time, in minor units. */
    labor_rate_minor: price,
    invoice_prefix: prefix,
    quote_prefix: prefix,
    reminders_enabled: z.boolean(),
    /** Printed on invoices and in invoice emails, e.g. bank transfer details. */
    payment_instructions: optionalText(2000),
  })
  .refine((v) => v.invoice_prefix !== v.quote_prefix, {
    message: "Use a different prefix for quotes and invoices",
    path: ["quote_prefix"],
  })
  .meta({ id: "BillingSettings" });
export type BillingSettingsInput = z.output<typeof billingSettingsSchema>;

// ---------------------------------------------------------------- API outputs

const ref = z.object({ id: z.uuid(), name: z.string() });

export const catalogItemSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(CATALOG_ITEM_KINDS),
    name: z.string(),
    description: z.string().nullable(),
    sku: z.string().nullable(),
    unit: z.string(),
    unit_price_minor: z.number().int(),
    unit_cost_minor: z.number().int().nullable(),
    currency: currencySchema,
    /** Null uses the organization's default rate. */
    tax_rate_bps: z.number().int().nullable(),
    active: z.boolean(),
  })
  .meta({ id: "CatalogItem" });
export type CatalogItemDto = z.infer<typeof catalogItemSchema>;

export const quoteLineSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int(),
    kind: lineKindSchema,
    catalog_item_id: z.uuid().nullable(),
    service_type_id: z.uuid().nullable(),
    description: z.string(),
    quantity: z.number(),
    unit: z.string().nullable(),
    unit_price_minor: z.number().int(),
    tax_rate_bps: z.number().int(),
    /** Quantity × unit price, before the document discount. */
    net_minor: z.number().int(),
    /** Tax on the line after its share of the document discount. */
    tax_minor: z.number().int(),
  })
  .meta({ id: "QuoteLine" });

const totals = {
  currency: currencySchema,
  discount_type: discountTypeSchema.nullable(),
  discount_value: z.number().int(),
  subtotal_minor: z.number().int(),
  discount_minor: z.number().int(),
  tax_minor: z.number().int(),
  total_minor: z.number().int(),
};

export const quoteSummarySchema = z
  .object({
    id: z.uuid(),
    number: z.string().meta({ example: "QUO-2026-0042" }),
    status: quoteStatusSchema,
    title: z.string(),
    customer: ref,
    site: z.object({ id: z.uuid(), label: z.string() }).nullable(),
    contact: z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable() }).nullable(),
    service_type: ref.nullable(),
    /** The job an approval created. */
    job: z.object({ id: z.uuid(), number: z.string() }).nullable(),
    ...totals,
    valid_until: z.string().nullable().meta({ format: "date" }),
    sent_at: ts.nullable(),
    viewed_at: ts.nullable(),
    decided_at: ts.nullable(),
    decline_reason: z.string().nullable(),
    version: z.number().int(),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "QuoteSummary" });
export type QuoteSummaryDto = z.infer<typeof quoteSummarySchema>;

export const quoteSchema = quoteSummarySchema
  .extend({ notes: z.string().nullable(), lines: z.array(quoteLineSchema) })
  .meta({ id: "Quote" });
export type QuoteDto = z.infer<typeof quoteSchema>;

export const invoiceLineSchema = quoteLineSchema
  .extend({
    expense_request_id: z.uuid().nullable(),
    unit_cost_minor: z.number().int().nullable(),
    markup_bps: z.number().int(),
  })
  .meta({ id: "InvoiceLine" });

export const paymentSchema = z
  .object({
    id: z.uuid(),
    invoice_id: z.uuid(),
    amount_minor: z.number().int(),
    currency: currencySchema,
    method: paymentMethodSchema,
    /** "manual", or the online provider that confirmed it. */
    provider: z.string(),
    reference: z.string().nullable(),
    note: z.string().nullable(),
    paid_at: ts,
    recorded_by: ref.nullable(),
    created_at: ts,
  })
  .meta({ id: "Payment" });
export type PaymentDto = z.infer<typeof paymentSchema>;

export const invoiceSummarySchema = z
  .object({
    id: z.uuid(),
    /** Assigned when the invoice is issued; null for drafts. */
    number: z.string().nullable().meta({ example: "INV-2026-0042" }),
    status: invoiceStatusSchema,
    customer: ref,
    site: z.object({ id: z.uuid(), label: z.string() }).nullable(),
    contact: z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable() }).nullable(),
    job: z.object({ id: z.uuid(), number: z.string(), title: z.string() }).nullable(),
    quote: z.object({ id: z.uuid(), number: z.string() }).nullable(),
    ...totals,
    amount_paid_minor: z.number().int(),
    balance_minor: z.number().int(),
    issue_date: z.string().nullable().meta({ format: "date" }),
    due_date: z.string().nullable().meta({ format: "date" }),
    sent_at: ts.nullable(),
    paid_at: ts.nullable(),
    voided_at: ts.nullable(),
    void_reason: z.string().nullable(),
    version: z.number().int(),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "InvoiceSummary" });
export type InvoiceSummaryDto = z.infer<typeof invoiceSummarySchema>;

export const invoiceSchema = invoiceSummarySchema
  .extend({
    notes: z.string().nullable(),
    lines: z.array(invoiceLineSchema),
    payments: z.array(paymentSchema),
  })
  .meta({ id: "Invoice" });
export type InvoiceDto = z.infer<typeof invoiceSchema>;
