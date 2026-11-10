import type { Currency, InvoiceStatus, Locale } from "@fieldops/shared";

// The words printed on customer documents, in the document's language (FIN-04, SET-05). Documents go to customers,
// so they follow the customer's language rather than the signed-in member's, and they render outside the web app's
// message files.

export interface DocumentLabels {
  quote: string;
  invoice: string;
  serviceReport: string;
  number: string;
  issued: string;
  validUntil: string;
  issueDate: string;
  dueDate: string;
  job: string;
  billTo: string;
  customer: string;
  serviceSite: string;
  description: string;
  quantity: string;
  unitPrice: string;
  tax: string;
  amount: string;
  subtotal: string;
  discount: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  notes: string;
  paymentInstructions: string;
  paid: string;
  void: string;
  draft: string;
  overdue: string;
  page: (n: number, total: number) => string;
  completed: string;
  technicians: string;
  workPerformed: string;
  findings: string;
  recommendations: string;
  nextService: string;
  nextServiceHint: string;
  checklist: string;
  item: string;
  result: string;
  done: string;
  notDone: string;
  partsUsed: string;
  part: string;
  photos: string;
  before: string;
  after: string;
  signature: string;
  signedBy: (name: string) => string;
  thankYou: string;
}

const en: DocumentLabels = {
  quote: "Quote",
  invoice: "Invoice",
  serviceReport: "Service report",
  number: "Number",
  issued: "Issued",
  validUntil: "Valid until",
  issueDate: "Issue date",
  dueDate: "Due date",
  job: "Job",
  billTo: "Bill to",
  customer: "Customer",
  serviceSite: "Service site",
  description: "Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  tax: "Tax",
  amount: "Amount",
  subtotal: "Subtotal",
  discount: "Discount",
  total: "Total",
  amountPaid: "Paid",
  balanceDue: "Balance due",
  notes: "Notes",
  paymentInstructions: "How to pay",
  paid: "Paid",
  void: "Void",
  draft: "Draft",
  overdue: "Overdue",
  page: (n, total) => `Page ${n} of ${total}`,
  completed: "Completed",
  technicians: "Technicians",
  workPerformed: "Work performed",
  findings: "Findings",
  recommendations: "Recommendations",
  nextService: "Next service",
  nextServiceHint: "Suggested date for the next visit",
  checklist: "Checklist",
  item: "Item",
  result: "Result",
  done: "Done",
  notDone: "Not done",
  partsUsed: "Parts used",
  part: "Part",
  photos: "Photos",
  before: "Before",
  after: "After",
  signature: "Customer signature",
  signedBy: (name) => `Signed by ${name}`,
  thankYou: "Thank you for your business.",
};

const id: DocumentLabels = {
  quote: "Penawaran",
  invoice: "Faktur",
  serviceReport: "Laporan servis",
  number: "Nomor",
  issued: "Tanggal",
  validUntil: "Berlaku sampai",
  issueDate: "Tanggal faktur",
  dueDate: "Jatuh tempo",
  job: "Pekerjaan",
  billTo: "Ditagihkan kepada",
  customer: "Pelanggan",
  serviceSite: "Lokasi servis",
  description: "Deskripsi",
  quantity: "Jml",
  unitPrice: "Harga satuan",
  tax: "Pajak",
  amount: "Jumlah",
  subtotal: "Subtotal",
  discount: "Diskon",
  total: "Total",
  amountPaid: "Dibayar",
  balanceDue: "Sisa tagihan",
  notes: "Catatan",
  paymentInstructions: "Cara pembayaran",
  paid: "Lunas",
  void: "Batal",
  draft: "Draf",
  overdue: "Lewat jatuh tempo",
  page: (n, total) => `Halaman ${n} dari ${total}`,
  completed: "Selesai",
  technicians: "Teknisi",
  workPerformed: "Pekerjaan yang dilakukan",
  findings: "Temuan",
  recommendations: "Rekomendasi",
  nextService: "Servis berikutnya",
  nextServiceHint: "Saran tanggal kunjungan berikutnya",
  checklist: "Daftar periksa",
  item: "Item",
  result: "Hasil",
  done: "Selesai",
  notDone: "Belum",
  partsUsed: "Suku cadang",
  part: "Suku cadang",
  photos: "Foto",
  before: "Sebelum",
  after: "Sesudah",
  signature: "Tanda tangan pelanggan",
  signedBy: (name) => `Ditandatangani oleh ${name}`,
  thankYou: "Terima kasih atas kepercayaan Anda.",
};

const LABELS: Record<Locale, DocumentLabels> = { en, id };

/** The labels for a document's language; unknown languages fall back to English. */
export function documentLabels(locale: Locale): DocumentLabels {
  return LABELS[locale] ?? en;
}

/** The invoice status word printed on a stamp or chip, or null for statuses without one. */
export function statusMark(status: InvoiceStatus, locale: Locale): string | null {
  const l = documentLabels(locale);
  switch (status) {
    case "paid":
      return l.paid;
    case "void":
      return l.void;
    case "draft":
      return l.draft;
    case "overdue":
      return l.overdue;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ formatting

/** Like the core's formatMoney (ADR 009): minor units, the currency's own locale, IDR without decimals. */
const CURRENCY: Record<Currency, { locale: string; digits: number }> = {
  USD: { locale: "en-US", digits: 2 },
  IDR: { locale: "id-ID", digits: 0 },
};

export function formatAmount(minor: number, currency: Currency): string {
  const info = CURRENCY[currency];
  return new Intl.NumberFormat(info.locale, {
    style: "currency",
    currency,
    minimumFractionDigits: info.digits,
    maximumFractionDigits: info.digits,
  }).format(minor / 100);
}

const intlLocale = (locale: Locale) => (locale === "id" ? "id-ID" : "en-US");

/** "2026-11-10" → "Nov 10, 2026" or "10 Nov 2026". Dates are calendar dates, so no time zone applies. */
export function formatDate(isoDate: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(d);
}

/** A quantity with up to two decimals in the document's language, and its unit: "1.5 h", "1,5 jam". */
export function formatQuantity(quantity: number, unit: string | null, locale: Locale): string {
  const n = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(quantity);
  return unit ? `${n} ${unit}` : n;
}

/** Tax in basis points as a percentage: 1100 → "11%", 825 → "8.25%" ("8,25%" in Indonesian). */
export function formatTaxRate(bps: number, locale: Locale): string {
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(bps / 100)}%`;
}
