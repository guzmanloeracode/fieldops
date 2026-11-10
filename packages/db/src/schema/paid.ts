import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contact, customer, equipment, expenseRequest, job, serviceType, site } from "./app";
import { member, organization, user } from "./auth";
import { aiInteraction } from "./automate";

// Release 0.4 (Get paid): the catalog, quotes, invoices and payments, service reports, maintenance plans
// (recurring jobs), the assistant's conversations and the owner digest log. Tenant tables follow the rules in
// app.ts: organization_id on every row, every index led by it, and the tenant_isolation policy (migration 0004).
// Money is integer minor units plus an ISO currency code (ADR 009); quantities are numeric(10,2).

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const minor = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

/** Parts with prices and fees (FIN-01). Services and their prices are the service types. */
export const catalogItem = pgTable(
  "catalog_item",
  {
    id: id(),
    organizationId: orgId(),
    /** part | fee */
    kind: text("kind").notNull().default("part"),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku"),
    /** Free text: "each", "m", "kg", "hour". */
    unit: text("unit").notNull().default("each"),
    unitPriceMinor: minor("unit_price_minor"),
    /** What the business pays, for margins. Optional. */
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }),
    currency: text("currency").notNull(),
    /** Null uses the organization's default tax rate. */
    taxRateBps: integer("tax_rate_bps"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("catalog_item_org_kind_name_idx").on(t.organizationId, t.kind, t.name),
    uniqueIndex("catalog_item_org_sku_uq")
      .on(t.organizationId, t.sku)
      .where(sql`sku is not null`),
    index("catalog_item_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

/** Quotes (FIN-02). Numbered on creation (QUO-2026-0001); an approved quote creates a job (`job_id`). */
export const quote = pgTable(
  "quote",
  {
    id: id(),
    organizationId: orgId(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id),
    siteId: uuid("site_id").references(() => site.id),
    /** Who receives it and may approve it in the portal. */
    contactId: uuid("contact_id").references(() => contact.id, { onDelete: "set null" }),
    /** Used for the job an approval creates. */
    serviceTypeId: uuid("service_type_id").references(() => serviceType.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => job.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** Customer-facing message on the quote. */
    notes: text("notes"),
    /** draft | sent | approved | declined | expired */
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull(),
    /** percent (value in basis points) | amount (value in minor units) | null */
    discountType: text("discount_type"),
    discountValue: minor("discount_value"),
    subtotalMinor: minor("subtotal_minor"),
    discountMinor: minor("discount_minor"),
    taxMinor: minor("tax_minor"),
    totalMinor: minor("total_minor"),
    validUntil: date("valid_until"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** First time the customer opened it in the portal. */
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByContactId: uuid("decided_by_contact_id").references(() => contact.id, { onDelete: "set null" }),
    /** Staff recording a decision the customer gave by phone or in person. */
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
    declineReason: text("decline_reason"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("quote_org_number_uq").on(t.organizationId, t.number),
    index("quote_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    index("quote_org_customer_idx").on(t.organizationId, t.customerId),
    index("quote_org_job_idx").on(t.organizationId, t.jobId),
  ],
);

export const quoteLine = pgTable(
  "quote_line",
  {
    id: id(),
    organizationId: orgId(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** service | labor | part | expense | fee */
    kind: text("kind").notNull(),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItem.id, { onDelete: "set null" }),
    serviceTypeId: uuid("service_type_id").references(() => serviceType.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
    unit: text("unit"),
    unitPriceMinor: minor("unit_price_minor"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    /** quantity × unit price, rounded; before the document discount. */
    netMinor: minor("net_minor"),
    /** Tax on the line after its share of the document discount. */
    taxMinor: minor("tax_minor"),
    createdAt: createdAt(),
  },
  (t) => [index("quote_line_org_quote_idx").on(t.organizationId, t.quoteId, t.position)],
);

/**
 * Invoices (FIN-03). The number (INV-2026-0001) is assigned when the invoice is issued, so numbers have no gaps;
 * drafts have none. `amount_paid_minor` is the sum of payments.
 */
export const invoice = pgTable(
  "invoice",
  {
    id: id(),
    organizationId: orgId(),
    number: text("number"),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id),
    siteId: uuid("site_id").references(() => site.id),
    jobId: uuid("job_id").references(() => job.id, { onDelete: "set null" }),
    quoteId: uuid("quote_id").references(() => quote.id, { onDelete: "set null" }),
    /** Bill-to contact: receives the invoice and reminders. */
    contactId: uuid("contact_id").references(() => contact.id, { onDelete: "set null" }),
    /** draft | sent | paid | overdue | void */
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull(),
    discountType: text("discount_type"),
    discountValue: minor("discount_value"),
    subtotalMinor: minor("subtotal_minor"),
    discountMinor: minor("discount_minor"),
    taxMinor: minor("tax_minor"),
    totalMinor: minor("total_minor"),
    amountPaidMinor: minor("amount_paid_minor"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    notes: text("notes"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    /** The open online-payment session, reused until it expires (FIN-05). */
    checkoutSessionId: text("checkout_session_id"),
    checkoutUrl: text("checkout_url"),
    checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("invoice_org_number_uq")
      .on(t.organizationId, t.number)
      .where(sql`number is not null`),
    index("invoice_org_status_due_idx").on(t.organizationId, t.status, t.dueDate),
    index("invoice_org_customer_idx").on(t.organizationId, t.customerId),
    index("invoice_org_job_idx").on(t.organizationId, t.jobId),
    index("invoice_org_issue_idx").on(t.organizationId, t.issueDate),
  ],
);

export const invoiceLine = pgTable(
  "invoice_line",
  {
    id: id(),
    organizationId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    kind: text("kind").notNull(),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItem.id, { onDelete: "set null" }),
    serviceTypeId: uuid("service_type_id").references(() => serviceType.id, { onDelete: "set null" }),
    /** An approved part or expense billed on this line (EXP-04). */
    expenseRequestId: uuid("expense_request_id").references(() => expenseRequest.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
    unit: text("unit"),
    /** Cost before markup, for expense and part lines. */
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }),
    markupBps: integer("markup_bps").notNull().default(0),
    unitPriceMinor: minor("unit_price_minor"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    netMinor: minor("net_minor"),
    taxMinor: minor("tax_minor"),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_line_org_invoice_idx").on(t.organizationId, t.invoiceId, t.position),
    index("invoice_line_org_expense_idx").on(t.organizationId, t.expenseRequestId),
  ],
);

/** Payments against an invoice (FIN-05): recorded by hand, or confirmed by the payment provider's webhook. */
export const payment = pgTable(
  "payment",
  {
    id: id(),
    organizationId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** card | bank_transfer | cash | other */
    method: text("method").notNull(),
    /** manual, or the online provider that confirmed it. */
    provider: text("provider").notNull().default("manual"),
    /** The provider's id for the payment; unique per provider, which makes webhooks idempotent. */
    providerRef: text("provider_ref"),
    /** A bank reference or receipt number typed by staff. */
    reference: text("reference"),
    note: text("note"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    recordedBy: uuid("recorded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("payment_org_invoice_idx").on(t.organizationId, t.invoiceId),
    index("payment_org_paid_idx").on(t.organizationId, t.paidAt),
    uniqueIndex("payment_org_provider_ref_uq")
      .on(t.organizationId, t.provider, t.providerRef)
      .where(sql`provider_ref is not null`),
  ],
);

/** Overdue reminders sent (FIN-06): one row per invoice and stage (3, 7, 14 days), so each goes out once. */
export const invoiceReminder = pgTable(
  "invoice_reminder",
  {
    organizationId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    stage: integer("stage").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.invoiceId, t.stage] })],
);

/** The customer-facing service report of a job (AI-03, FIN-04): drafted, edited, then sent as a PDF. */
export const serviceReport = pgTable(
  "service_report",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    /** draft | sent */
    status: text("status").notNull().default("draft"),
    /** The customer's language (SET-05). */
    locale: text("locale").notNull().default("en"),
    workPerformed: text("work_performed"),
    findings: text("findings"),
    recommendations: text("recommendations"),
    nextServiceDate: date("next_service_date"),
    /** AI drafting, claimed by the worker like portal requests: pending | drafting | drafted | failed | skipped. */
    aiStatus: text("ai_status"),
    aiInteractionId: uuid("ai_interaction_id").references(() => aiInteraction.id, { onDelete: "set null" }),
    aiDrafted: boolean("ai_drafted").notNull().default(false),
    editedBy: uuid("edited_by").references(() => user.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentTo: text("sent_to"),
    sentBy: uuid("sent_by").references(() => user.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("service_report_org_job_uq").on(t.organizationId, t.jobId),
    index("service_report_org_ai_status_idx")
      .on(t.organizationId, t.aiStatus)
      .where(sql`ai_status = 'pending'`),
  ],
);

/**
 * Maintenance plans (JOB-13): a recurrence rule that generates jobs `lead_days` ahead. `next_on` is the next
 * occurrence not generated yet; each generated job carries the plan and its occurrence date (unique together).
 */
export const jobRecurrence = pgTable(
  "job_recurrence",
  {
    id: id(),
    organizationId: orgId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id),
    equipmentId: uuid("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
    serviceTypeId: uuid("service_type_id").references(() => serviceType.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("normal"),
    /** day | week | month | year */
    intervalUnit: text("interval_unit").notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    /** Preferred visit window in the organization's time zone, e.g. "09:00" for 120 minutes. */
    windowStart: text("window_start"),
    windowMinutes: integer("window_minutes"),
    leadDays: integer("lead_days").notNull().default(14),
    nextOn: date("next_on").notNull(),
    /** Preferred technician; generated jobs are still unassigned unless the plan says otherwise. */
    leadMemberId: uuid("lead_member_id").references(() => member.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("job_recurrence_org_next_idx").on(t.organizationId, t.active, t.nextOn),
    index("job_recurrence_org_customer_idx").on(t.organizationId, t.customerId),
  ],
);

/** Ask FieldOps conversations (AI-02), private to their user and kept 30 days. */
export const assistantConversation = pgTable(
  "assistant_conversation",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assistant_conversation_org_user_idx").on(t.organizationId, t.userId, t.updatedAt)],
);

export const assistantMessage = pgTable(
  "assistant_message",
  {
    id: id(),
    organizationId: orgId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => assistantConversation.id, { onDelete: "cascade" }),
    /** user | assistant */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** The tools that ran for an answer, with a short summary each ("Looked up 12 jobs"). */
    tools: jsonb("tools")
      .notNull()
      .default(sql`'[]'::jsonb`),
    aiInteractionId: uuid("ai_interaction_id").references(() => aiInteraction.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("assistant_message_org_conversation_idx").on(t.organizationId, t.conversationId, t.createdAt),
  ],
);

/** Owner digests sent (NOT-04): one per user and local date, so a retried run never sends twice. */
export const dailyDigest = pgTable(
  "daily_digest",
  {
    organizationId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    digestDate: date("digest_date").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId, t.digestDate] })],
);
