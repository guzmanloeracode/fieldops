import type { Currency, InvoiceStatus, Locale } from "@fieldops/shared";

// The data a PDF needs, already resolved by the caller: names, formatted addresses, totals in minor units.
// Renderers never touch the database, so the web app builds these from its records and the documents slice can
// develop and test the layouts on their own (FIN-04).

/** The business on the letterhead. */
export interface DocumentBrand {
  name: string;
  /** PNG or JPEG bytes of the logo, or null. */
  logo: Uint8Array | null;
  /** "#0f766e"; null uses the default accent. */
  brandColor: string | null;
  /** Address lines, already formatted. */
  addressLines: string[];
  email: string | null;
  phone: string | null;
  timeZone: string;
}

/** A customer, contact or site block. */
export interface DocumentParty {
  name: string;
  lines: string[];
}

export interface DocumentLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceMinor: number;
  taxRateBps: number;
  /** quantity × unit price, before the document discount. */
  netMinor: number;
}

export interface DocumentTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

interface DocumentBase {
  locale: Locale;
  currency: Currency;
  brand: DocumentBrand;
}

export interface QuoteDocument extends DocumentBase {
  number: string;
  title: string;
  customer: DocumentParty;
  site: DocumentParty | null;
  /** YYYY-MM-DD in the organization's time zone. */
  issuedOn: string;
  validUntil: string | null;
  notes: string | null;
  lines: DocumentLine[];
  totals: DocumentTotals;
}

export interface InvoiceDocument extends DocumentBase {
  number: string;
  status: InvoiceStatus;
  billTo: DocumentParty;
  site: DocumentParty | null;
  /** "JOB-000123" when the invoice bills a job. */
  jobNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  paymentInstructions: string | null;
  lines: DocumentLine[];
  totals: DocumentTotals & { amountPaidMinor: number; balanceMinor: number };
}

export interface ReportPhoto {
  tag: "before" | "after" | null;
  caption: string | null;
  /** JPEG or PNG bytes; other formats are skipped. At most MAX_REPORT_PHOTOS are printed. */
  image: Uint8Array;
}

export interface ServiceReportDocument extends DocumentBase {
  jobNumber: string;
  title: string;
  customer: DocumentParty;
  site: DocumentParty;
  /** YYYY-MM-DD: the day the job was completed, in the organization's time zone. */
  completedOn: string;
  technicians: string[];
  workPerformed: string;
  findings: string | null;
  recommendations: string | null;
  nextServiceDate: string | null;
  /** Checklist results: `value` is the reading or text already formatted ("12.5 °C"), null for a checkbox. */
  checklist: { label: string; value: string | null; done: boolean }[];
  partsUsed: { description: string; quantity: number; unit: string | null }[];
  photos: ReportPhoto[];
  signature: { name: string | null; image: Uint8Array } | null;
}
