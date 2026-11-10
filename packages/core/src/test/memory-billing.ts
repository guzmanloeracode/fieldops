import type { InvoiceStatus, QuoteStatus } from "@fieldops/shared";
import { balanceOf } from "../domain/billing";
import { weekStart } from "../domain/date-range";
import type {
  CatalogItemRecord,
  InvoiceLineRecord,
  InvoiceRecord,
  InvoiceView,
  OutboxEmail,
  PaymentRecord,
  PartyRefs,
  QuoteLineRecord,
  QuoteRecord,
  QuoteView,
  UpdateGuard,
} from "../services/billing-types";
import type { Store } from "../services/types";
import type { MemoryData } from "./memory-store";

/** What the in-memory billing repository holds, for assertions in tests. */
export interface MemoryBilling {
  counters: Map<string, number>;
  catalog: CatalogItemRecord[];
  quotes: QuoteRecord[];
  quoteLines: (QuoteLineRecord & { quoteId: string })[];
  invoices: InvoiceRecord[];
  invoiceLines: (InvoiceLineRecord & { invoiceId: string })[];
  payments: (PaymentRecord & { recordedByUserId: string | null })[];
  reminders: { invoiceId: string; stage: number; sentAt: Date }[];
  outbox: OutboxEmail[];
}

/** Local date of an instant in UTC (the memory store's organizations use UTC). */
const day = (d: Date) => d.toISOString().slice(0, 10);

/** In-memory billing repository for unit tests; SQL behaviour is covered by the packages/db integration tests. */
export function memoryBilling(
  data: MemoryData & { billing?: MemoryBilling },
  uuid: () => string,
): Pick<Store, "billing"> {
  const m: MemoryBilling = (data.billing ??= {
    counters: new Map(),
    catalog: [],
    quotes: [],
    quoteLines: [],
    invoices: [],
    invoiceLines: [],
    payments: [],
    reminders: [],
    outbox: [],
  });
  let tick = 0;
  const stamp = () => new Date(Date.now() + tick++);

  const parties = (customerId: string, siteId: string | null, contactId: string | null): PartyRefs => {
    const site = siteId ? data.sites.find((s) => s.id === siteId) : undefined;
    const contact = contactId ? data.contacts.find((c) => c.id === contactId) : undefined;
    return {
      customer: { id: customerId, name: data.customers.find((c) => c.id === customerId)?.name ?? "" },
      site: site ? { id: site.id, label: site.label, address: site.address } : null,
      contact: contact ? { id: contact.id, name: contact.name, email: contact.email } : null,
    };
  };
  const nameOf = (userId: string | null) => data.members.find((x) => x.userId === userId)?.name ?? null;

  const quoteRow = (q: QuoteRecord) => {
    const st = q.serviceTypeId ? data.serviceTypes.find((s) => s.id === q.serviceTypeId) : undefined;
    const job = q.jobId ? data.jobs.find((j) => j.id === q.jobId) : undefined;
    const contact = q.decidedByContactId
      ? data.contacts.find((c) => c.id === q.decidedByContactId)
      : undefined;
    return {
      ...q,
      ...parties(q.customerId, q.siteId, q.contactId),
      serviceType: st ? { id: st.id, name: st.name } : null,
      job: job ? { id: job.id, number: job.number } : null,
      decidedByName: contact?.name ?? nameOf(q.decidedByUserId),
    };
  };
  const quoteView = (q: QuoteRecord): QuoteView => ({
    ...quoteRow(q),
    lines: m.quoteLines
      .filter((l) => l.quoteId === q.id)
      .sort((a, b) => a.position - b.position)
      .map(({ quoteId: _q, ...l }) => l),
  });

  const invoiceRow = (i: InvoiceRecord) => {
    const job = i.jobId ? data.jobs.find((j) => j.id === i.jobId) : undefined;
    const quote = i.quoteId ? m.quotes.find((q) => q.id === i.quoteId) : undefined;
    return {
      ...i,
      ...parties(i.customerId, i.siteId, i.contactId),
      job: job ? { id: job.id, number: job.number, title: job.title } : null,
      quote: quote ? { id: quote.id, number: quote.number } : null,
    };
  };
  const invoiceView = (i: InvoiceRecord): InvoiceView => ({
    ...invoiceRow(i),
    lines: m.invoiceLines
      .filter((l) => l.invoiceId === i.id)
      .sort((a, b) => a.position - b.position)
      .map(({ invoiceId: _i, ...l }) => l),
    payments: m.payments.filter((p) => p.invoiceId === i.id).map(({ recordedByUserId: _r, ...p }) => p),
  });

  function guarded<S extends string, R extends { status: S; version: number }>(
    row: R | undefined,
    guard?: UpdateGuard<S>,
  ): row is R {
    if (!row) return false;
    if (guard?.expectedVersion !== undefined && row.version !== guard.expectedVersion) return false;
    if (guard?.fromStatuses && !guard.fromStatuses.includes(row.status)) return false;
    return true;
  }

  function page<T>(rows: T[], f: { limit: number; page?: number }) {
    const offset = f.page ? (f.page - 1) * f.limit : 0;
    return {
      rows: rows.slice(offset, offset + f.limit),
      nextCursor: null,
      total: f.page ? rows.length : null,
    };
  }

  const liveInvoices = () => m.invoices.filter((i) => i.status !== "void");

  return {
    billing: {
      async nextCounter(name) {
        const n = (m.counters.get(name) ?? 0) + 1;
        m.counters.set(name, n);
        return n;
      },

      async listCatalog(f) {
        const q = f.q?.toLowerCase();
        return m.catalog
          .filter((c) => f.includeInactive || c.active)
          .filter((c) => !f.kind || c.kind === f.kind)
          .filter((c) => !q || c.name.toLowerCase().includes(q) || c.sku?.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, f.limit);
      },
      async getCatalogItem(id) {
        return m.catalog.find((c) => c.id === id) ?? null;
      },
      async findCatalogItemBySku(sku) {
        return m.catalog.find((c) => c.sku === sku) ?? null;
      },
      async createCatalogItem(input) {
        const now = stamp();
        const item = { ...input, id: uuid(), createdAt: now, updatedAt: now };
        m.catalog.push(item);
        return item;
      },
      async updateCatalogItem(id, patch) {
        const item = m.catalog.find((c) => c.id === id);
        if (!item) return null;
        Object.assign(item, patch, { updatedAt: stamp() });
        return item;
      },

      async listQuotes(f) {
        const q = f.q?.toLowerCase();
        const rows = m.quotes
          .filter((x) => !f.status?.length || f.status.includes(x.status))
          .filter((x) => !f.customer || x.customerId === f.customer)
          .filter((x) => !f.job || x.jobId === f.job)
          .filter((x) => !f.from || day(x.createdAt) >= f.from)
          .filter((x) => !f.to || day(x.createdAt) <= f.to)
          .map(quoteRow)
          .filter(
            (x) =>
              !q ||
              x.number.toLowerCase().includes(q) ||
              x.title.toLowerCase().includes(q) ||
              x.customer.name.toLowerCase().includes(q),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return page(rows, f);
      },
      async getQuote(id) {
        const q = m.quotes.find((x) => x.id === id);
        return q ? quoteView(q) : null;
      },
      async getQuoteByNumber(number) {
        const q = m.quotes.find((x) => x.number === number);
        return q ? quoteView(q) : null;
      },
      async createQuote(input, lines) {
        const now = stamp();
        const q: QuoteRecord = {
          ...input,
          id: uuid(),
          jobId: null,
          sentAt: null,
          viewedAt: null,
          decidedAt: null,
          decidedByContactId: null,
          decidedByUserId: null,
          declineReason: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        m.quotes.push(q);
        m.quoteLines.push(...lines.map((l) => ({ ...l, id: uuid(), quoteId: q.id })));
        return q;
      },
      async updateQuote(id, patch, guard?: UpdateGuard<QuoteStatus>) {
        const q = m.quotes.find((x) => x.id === id);
        if (!guarded(q, guard)) return null;
        Object.assign(q, patch, { version: q.version + 1, updatedAt: stamp() });
        return q;
      },
      async replaceQuoteLines(quoteId, lines) {
        m.quoteLines = m.quoteLines.filter((l) => l.quoteId !== quoteId);
        m.quoteLines.push(...lines.map((l) => ({ ...l, id: uuid(), quoteId })));
      },
      async quoteForJob(jobId) {
        const q = m.quotes.find((x) => x.jobId === jobId);
        return q ? quoteRow(q) : null;
      },
      async expireQuotes(today) {
        const due = m.quotes.filter(
          (q) => q.status === "sent" && q.validUntil !== null && q.validUntil < today,
        );
        for (const q of due) Object.assign(q, { status: "expired", version: q.version + 1 });
        return due.map((q) => q.id);
      },

      async listInvoices(f) {
        const q = f.q?.toLowerCase();
        const rows = m.invoices
          .filter((x) => !f.status?.length || f.status.includes(x.status))
          .filter((x) => !f.customer || x.customerId === f.customer)
          .filter((x) => !f.job || x.jobId === f.job)
          .filter((x) => !f.from || (x.issueDate !== null && x.issueDate >= f.from))
          .filter((x) => !f.to || (x.issueDate !== null && x.issueDate <= f.to))
          .map(invoiceRow)
          .filter(
            (x) =>
              !q || (x.number ?? "").toLowerCase().includes(q) || x.customer.name.toLowerCase().includes(q),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return page(rows, f);
      },
      async getInvoice(id) {
        const i = m.invoices.find((x) => x.id === id);
        return i ? invoiceView(i) : null;
      },
      async createInvoice(input, lines) {
        const now = stamp();
        const inv: InvoiceRecord = {
          ...input,
          id: uuid(),
          number: null,
          status: "draft",
          amountPaidMinor: 0,
          issueDate: null,
          dueDate: null,
          sentAt: null,
          viewedAt: null,
          paidAt: null,
          voidedAt: null,
          voidReason: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        m.invoices.push(inv);
        m.invoiceLines.push(...lines.map((l) => ({ ...l, id: uuid(), invoiceId: inv.id })));
        return inv;
      },
      async updateInvoice(id, patch, guard?: UpdateGuard<InvoiceStatus>) {
        const inv = m.invoices.find((x) => x.id === id);
        if (!guarded(inv, guard)) return null;
        Object.assign(inv, patch, { version: inv.version + 1, updatedAt: stamp() });
        return inv;
      },
      async replaceInvoiceLines(invoiceId, lines) {
        m.invoiceLines = m.invoiceLines.filter((l) => l.invoiceId !== invoiceId);
        m.invoiceLines.push(...lines.map((l) => ({ ...l, id: uuid(), invoiceId })));
      },
      async billedExpenseIds(expenseIds, exceptInvoiceId) {
        const live = new Set(
          liveInvoices()
            .filter((i) => i.id !== exceptInvoiceId)
            .map((i) => i.id),
        );
        const billed = new Set(
          m.invoiceLines
            .filter((l) => live.has(l.invoiceId) && l.expenseRequestId)
            .map((l) => l.expenseRequestId),
        );
        return expenseIds.filter((id) => billed.has(id));
      },
      async receivables(asOf) {
        const out = { outstandingMinor: 0, outstandingCount: 0, overdueMinor: 0, overdueCount: 0 };
        for (const i of m.invoices) {
          if (!i.issueDate || i.issueDate > asOf || i.status === "draft") continue;
          if (i.voidedAt && day(i.voidedAt) <= asOf) continue;
          const paid = m.payments
            .filter((p) => p.invoiceId === i.id && day(p.paidAt) <= asOf)
            .reduce((a, p) => a + p.amountMinor, 0);
          const balance = i.totalMinor - paid;
          if (balance <= 0) continue;
          out.outstandingMinor += balance;
          out.outstandingCount += 1;
          if (i.dueDate && i.dueDate < asOf) {
            out.overdueMinor += balance;
            out.overdueCount += 1;
          }
        }
        return out;
      },

      async applyPaymentToInvoice(invoiceId, amountMinor, paidAt) {
        const inv = m.invoices.find((x) => x.id === invoiceId);
        if (!inv || (inv.status !== "sent" && inv.status !== "overdue")) return null;
        if (inv.amountPaidMinor + amountMinor > inv.totalMinor) return null;
        inv.amountPaidMinor += amountMinor;
        if (balanceOf(inv) === 0) Object.assign(inv, { status: "paid", paidAt });
        Object.assign(inv, { version: inv.version + 1, updatedAt: stamp() });
        return inv;
      },
      async addPayment(input) {
        const { recordedByUserId, ...rest } = input;
        const name = nameOf(recordedByUserId);
        const p = {
          ...rest,
          id: uuid(),
          recordedByUserId,
          recordedBy: recordedByUserId && name ? { id: recordedByUserId, name } : null,
          createdAt: stamp(),
        };
        m.payments.push(p);
        const { recordedByUserId: _r, ...record } = p;
        return record;
      },
      async findPayment(provider, providerRef) {
        const p = m.payments.find((x) => x.provider === provider && x.providerRef === providerRef);
        if (!p) return null;
        const { recordedByUserId: _r, ...record } = p;
        return record;
      },

      async markOverdue(today) {
        const due = m.invoices.filter(
          (i) => i.status === "sent" && i.dueDate !== null && i.dueDate < today && balanceOf(i) > 0,
        );
        for (const i of due) Object.assign(i, { status: "overdue", version: i.version + 1 });
        return due.map((i) => i.id);
      },
      async reminderCandidates() {
        return m.invoices
          .filter((i) => i.status === "overdue" && balanceOf(i) > 0 && i.dueDate)
          .filter((i) => data.contacts.some((c) => c.id === i.contactId && c.email))
          .map((i) => ({
            invoiceId: i.id,
            dueDate: i.dueDate!,
            sentStages: m.reminders.filter((r) => r.invoiceId === i.id).map((r) => r.stage),
          }));
      },
      async recordReminder(invoiceId, stage, at) {
        if (m.reminders.some((r) => r.invoiceId === invoiceId && r.stage === stage)) return false;
        m.reminders.push({ invoiceId, stage, sentAt: at });
        return true;
      },

      async revenueTotals(f) {
        const inRange = (d: string | null) => d !== null && d >= f.from && d <= f.to;
        const issued = liveInvoices().filter((i) => i.status !== "draft" && inRange(i.issueDate));
        const paid = m.payments.filter((p) => inRange(day(p.paidAt)));
        return {
          invoicedMinor: issued.reduce((a, i) => a + i.totalMinor, 0),
          invoicedCount: issued.length,
          collectedMinor: paid.reduce((a, p) => a + p.amountMinor, 0),
          paymentCount: paid.length,
        };
      },
      async revenueSeries(f, bucket) {
        const start = (d: string) => (bucket === "day" ? d : weekStart(d));
        const map = new Map<string, { bucket: string; invoicedMinor: number; collectedMinor: number }>();
        const row = (b: string) =>
          map.get(b) ?? map.set(b, { bucket: b, invoicedMinor: 0, collectedMinor: 0 }).get(b)!;
        for (const i of liveInvoices()) {
          if (i.status === "draft" || !i.issueDate || i.issueDate < f.from || i.issueDate > f.to) continue;
          row(start(i.issueDate)).invoicedMinor += i.totalMinor;
        }
        for (const p of m.payments) {
          const d = day(p.paidAt);
          if (d < f.from || d > f.to) continue;
          row(start(d)).collectedMinor += p.amountMinor;
        }
        return [...map.values()];
      },

      async queueEmail(email) {
        m.outbox.push(email);
      },
    },
  };
}
