import type {
  Address,
  CatalogItemKind,
  Currency,
  DiscountType,
  InvoiceListQuery,
  InvoiceStatus,
  LineKind,
  Locale,
  PaymentMethod,
  QuoteListQuery,
  QuoteStatus,
} from "@fieldops/shared";
import type { Bucket } from "../domain/date-range";
import type { ReportFilters } from "./insights-types";
import type { Page, ServiceContext } from "./types";

// Catalog, quotes, invoices, payments and reminders (FIN-01–07, EXP-04). Kept apart from types.ts so the 0.4
// slices merge cleanly. Dates without a time (valid until, issue and due dates) are "YYYY-MM-DD" local dates of
// the organization.

export interface CatalogItemRecord {
  id: string;
  kind: CatalogItemKind;
  name: string;
  description: string | null;
  sku: string | null;
  unit: string;
  unitPriceMinor: number;
  unitCostMinor: number | null;
  currency: Currency;
  /** Null uses the organization's default rate. */
  taxRateBps: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewCatalogItem = Omit<CatalogItemRecord, "id" | "createdAt" | "updatedAt">;

export interface CatalogFilters {
  q?: string;
  kind?: CatalogItemKind;
  includeInactive?: boolean;
  limit: number;
}

/** A line as stored: the amounts are computed by `computeTotals` when the document is saved. */
export interface QuoteLineRecord {
  id: string;
  position: number;
  kind: LineKind;
  catalogItemId: string | null;
  serviceTypeId: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceMinor: number;
  taxRateBps: number;
  netMinor: number;
  taxMinor: number;
}

export interface InvoiceLineRecord extends QuoteLineRecord {
  /** The approved part or expense this line bills (EXP-04). */
  expenseRequestId: string | null;
  unitCostMinor: number | null;
  markupBps: number;
}

export type NewQuoteLine = Omit<QuoteLineRecord, "id">;
export type NewInvoiceLine = Omit<InvoiceLineRecord, "id">;

export interface DocumentTotalsRecord {
  currency: Currency;
  discountType: DiscountType | null;
  discountValue: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface QuoteRecord extends DocumentTotalsRecord {
  id: string;
  number: string;
  customerId: string;
  siteId: string | null;
  contactId: string | null;
  serviceTypeId: string | null;
  jobId: string | null;
  title: string;
  notes: string | null;
  status: QuoteStatus;
  validUntil: string | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  decidedAt: Date | null;
  decidedByContactId: string | null;
  decidedByUserId: string | null;
  declineReason: string | null;
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PartyRefs {
  customer: { id: string; name: string };
  site: { id: string; label: string; address: Address } | null;
  contact: { id: string; name: string; email: string | null } | null;
}

/** A quote with the names the pages, emails and PDF show. */
export interface QuoteView extends QuoteRecord, PartyRefs {
  serviceType: { id: string; name: string } | null;
  job: { id: string; number: number } | null;
  /** Who recorded the decision: the contact in the portal, or a staff member on their behalf. */
  decidedByName: string | null;
  lines: QuoteLineRecord[];
}

/** A row of the quotes list (no lines). */
export type QuoteListRow = Omit<QuoteView, "lines">;

export type NewQuote = Omit<
  QuoteRecord,
  | "id"
  | "version"
  | "createdAt"
  | "updatedAt"
  | "sentAt"
  | "viewedAt"
  | "decidedAt"
  | "decidedByContactId"
  | "decidedByUserId"
  | "declineReason"
  | "jobId"
>;

export type QuotePatch = Partial<
  Omit<QuoteRecord, "id" | "number" | "customerId" | "currency" | "version" | "createdAt" | "updatedAt">
>;

export interface InvoiceRecord extends DocumentTotalsRecord {
  id: string;
  /** Assigned when issued; null for drafts. */
  number: string | null;
  customerId: string;
  siteId: string | null;
  jobId: string | null;
  quoteId: string | null;
  contactId: string | null;
  status: InvoiceStatus;
  amountPaidMinor: number;
  issueDate: string | null;
  dueDate: string | null;
  notes: string | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  amountMinor: number;
  currency: Currency;
  method: PaymentMethod;
  /** "manual", or the online provider that confirmed it. */
  provider: string;
  providerRef: string | null;
  reference: string | null;
  note: string | null;
  paidAt: Date;
  recordedBy: { id: string; name: string } | null;
  createdAt: Date;
}

export type NewPayment = Omit<PaymentRecord, "id" | "createdAt" | "recordedBy"> & {
  recordedByUserId: string | null;
};

export interface InvoiceView extends InvoiceRecord, PartyRefs {
  job: { id: string; number: number; title: string } | null;
  quote: { id: string; number: string } | null;
  lines: InvoiceLineRecord[];
  payments: PaymentRecord[];
}

export type InvoiceListRow = Omit<InvoiceView, "lines" | "payments">;

export type NewInvoice = Omit<
  InvoiceRecord,
  | "id"
  | "number"
  | "status"
  | "amountPaidMinor"
  | "issueDate"
  | "dueDate"
  | "sentAt"
  | "viewedAt"
  | "paidAt"
  | "voidedAt"
  | "voidReason"
  | "version"
  | "createdAt"
  | "updatedAt"
>;

export type InvoicePatch = Partial<
  Omit<InvoiceRecord, "id" | "customerId" | "currency" | "version" | "createdAt" | "updatedAt">
>;

/** An online checkout session stored on an issued invoice (FIN-05): reused until it expires. */
export interface StoredCheckout {
  /** The provider's session id ("cs_…" for Stripe, "sim_…" for the simulated checkout). */
  sessionId: string;
  url: string;
  expiresAt: Date;
}

/** Optimistic and state guards for an update: it applies only if the row still matches. */
export interface UpdateGuard<S> {
  expectedVersion?: number;
  /** The update applies only while the document is in one of these states (race-safe transitions). */
  fromStatuses?: readonly S[];
}

/** Open receivables now: issued invoices with a balance, and the part past due (FIN-06, DSH-01). */
export interface ReceivablesSummary {
  outstandingMinor: number;
  outstandingCount: number;
  overdueMinor: number;
  overdueCount: number;
}

export interface RevenueTotals {
  /** Invoices issued in the period (not void): their totals. */
  invoicedMinor: number;
  invoicedCount: number;
  /** Payments received in the period. */
  collectedMinor: number;
  paymentCount: number;
}

export interface RevenueBucketRow {
  bucket: string;
  invoicedMinor: number;
  collectedMinor: number;
}

/** An overdue invoice with a balance and a bill-to email, for reminders (FIN-06). */
export interface ReminderCandidate {
  invoiceId: string;
  dueDate: string;
  /** Stages already recorded for this invoice. */
  sentStages: number[];
}

export interface OutboxEmail {
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  kind: string;
  /** Demo mode stores customer emails as "captured" instead of sending them (DEM-05). */
  captured: boolean;
}

export interface BillingRepo {
  // ---- numbering
  /** Increments a per-organization counter such as "quote:2026" and returns the new value (gap-free, locked). */
  nextCounter(name: string): Promise<number>;

  // ---- catalog (FIN-01)
  listCatalog(filters: CatalogFilters): Promise<CatalogItemRecord[]>;
  getCatalogItem(id: string): Promise<CatalogItemRecord | null>;
  findCatalogItemBySku(sku: string): Promise<CatalogItemRecord | null>;
  createCatalogItem(data: NewCatalogItem): Promise<CatalogItemRecord>;
  updateCatalogItem(
    id: string,
    patch: Partial<Omit<CatalogItemRecord, "id" | "currency" | "createdAt" | "updatedAt">>,
  ): Promise<CatalogItemRecord | null>;

  // ---- quotes (FIN-02)
  listQuotes(filters: QuoteListQuery): Promise<Page<QuoteListRow>>;
  getQuote(id: string): Promise<QuoteView | null>;
  getQuoteByNumber(number: string): Promise<QuoteView | null>;
  createQuote(data: NewQuote, lines: NewQuoteLine[]): Promise<QuoteRecord>;
  /** Applies the patch and bumps the version; null when the guard doesn't match. */
  updateQuote(id: string, patch: QuotePatch, guard?: UpdateGuard<QuoteStatus>): Promise<QuoteRecord | null>;
  replaceQuoteLines(quoteId: string, lines: NewQuoteLine[]): Promise<void>;
  /** The quote that created this job, if any. */
  quoteForJob(jobId: string): Promise<QuoteListRow | null>;
  /** Sent quotes whose validity date is before `today` become expired. Returns their ids. */
  expireQuotes(today: string): Promise<string[]>;

  // ---- invoices (FIN-03, EXP-04)
  listInvoices(filters: InvoiceListQuery): Promise<Page<InvoiceListRow>>;
  getInvoice(id: string): Promise<InvoiceView | null>;
  createInvoice(data: NewInvoice, lines: NewInvoiceLine[]): Promise<InvoiceRecord>;
  updateInvoice(
    id: string,
    patch: InvoicePatch,
    guard?: UpdateGuard<InvoiceStatus>,
  ): Promise<InvoiceRecord | null>;
  replaceInvoiceLines(invoiceId: string, lines: NewInvoiceLine[]): Promise<void>;
  /**
   * Of these expense requests, the ones already billed on an invoice that isn't void (optionally ignoring one
   * invoice, the one being edited).
   */
  billedExpenseIds(expenseIds: string[], exceptInvoiceId?: string): Promise<string[]>;
  receivables(today: string): Promise<ReceivablesSummary>;

  // ---- payments (FIN-05)
  /**
   * Adds an amount to an issued invoice's paid amount, only while the invoice is sent or overdue and the amount
   * fits the balance (race-safe). Settling the total marks it paid at `paidAt`. The stored checkout session is
   * dropped, since its amount no longer matches the balance. Null when the guard fails.
   */
  applyPaymentToInvoice(invoiceId: string, amountMinor: number, paidAt: Date): Promise<InvoiceRecord | null>;
  addPayment(data: NewPayment): Promise<PaymentRecord>;
  /** A payment confirmed by an online provider, by the provider's reference (idempotent webhooks). */
  findPayment(provider: string, providerRef: string): Promise<PaymentRecord | null>;

  // ---- online payments and the customer portal (FIN-05, POR-04)
  /** The invoice's stored checkout session, expired or not. */
  getCheckout(invoiceId: string): Promise<StoredCheckout | null>;
  /** Stores the checkout session of a sent or overdue invoice. False when the invoice isn't open any more. */
  saveCheckout(invoiceId: string, checkout: StoredCheckout): Promise<boolean>;
  /** Records when the customer first opened the document in the portal (no version change). */
  markViewed(kind: "quote" | "invoice", id: string, at: Date): Promise<void>;

  // ---- overdue and reminders (FIN-06)
  /** Sent invoices due before `today` with a balance become overdue. Returns their ids. */
  markOverdue(today: string): Promise<string[]>;
  /** Overdue invoices with a balance whose bill-to contact has an email. */
  reminderCandidates(): Promise<ReminderCandidate[]>;
  /** Records a reminder stage once. True when this call recorded it (the email should go out). */
  recordReminder(invoiceId: string, stage: number, at: Date): Promise<boolean>;

  // ---- revenue (DSH-01, DSH-02)
  revenueTotals(f: ReportFilters): Promise<RevenueTotals>;
  revenueSeries(f: ReportFilters, bucket: Bucket): Promise<RevenueBucketRow[]>;

  // ---- email
  /** Writes a customer email to the outbox in the current transaction (NOT-02 pattern). */
  queueEmail(email: OutboxEmail): Promise<void>;
}

// ------------------------------------------------------------------ customer emails

/** Facts shared by every billing email to a customer. Amounts and dates are already formatted. */
interface CustomerEmailBase {
  to: string;
  contactName: string;
  organizationName: string;
  /** The language of the customer's documents (SET-05). */
  locale: Locale;
  /** App-relative link, e.g. /portal/acme/invoices/<id>; the mailer makes it absolute. */
  path: string;
}

export type CustomerEmail =
  | (CustomerEmailBase & {
      kind: "quote_sent";
      number: string;
      title: string;
      total: string;
      validUntil: string | null;
    })
  | (CustomerEmailBase & {
      kind: "invoice_sent";
      number: string;
      total: string;
      balance: string;
      dueDate: string | null;
      paymentInstructions: string | null;
    })
  | (CustomerEmailBase & {
      kind: "payment_receipt";
      number: string;
      amount: string;
      balance: string;
      paidAt: string;
      method: PaymentMethod;
      paidInFull: boolean;
    })
  | (CustomerEmailBase & {
      kind: "invoice_reminder";
      number: string;
      balance: string;
      dueDate: string;
      daysOverdue: number;
      paymentInstructions: string | null;
    });

/** Sends billing emails to customers through the outbox, in the caller's transaction. Web and worker implement it. */
export interface CustomerMailer {
  send(email: CustomerEmail): Promise<void>;
}

/** A service context that can also email customers (quotes, invoices, receipts, reminders). */
export interface BillingContext extends ServiceContext {
  customerMailer?: CustomerMailer;
}
