import type {
  BillingRepo,
  CatalogItemRecord,
  InvoiceLineRecord,
  InvoiceListRow,
  InvoiceRecord,
  InvoiceView,
  NewInvoiceLine,
  NewQuoteLine,
  PartyRefs,
  PaymentRecord,
  QuoteLineRecord,
  QuoteListRow,
  QuoteRecord,
  QuoteView,
  UpdateGuard,
} from "@fieldops/core";
import { decodeCursor, encodeCursor } from "@fieldops/core";
import type {
  CatalogItemKind,
  Currency,
  DiscountType,
  InvoiceStatus,
  LineKind,
  PaymentMethod,
  QuoteStatus,
} from "@fieldops/shared";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../client";
import {
  catalogItem,
  contact,
  customer,
  emailOutbox,
  expenseRequest,
  invoice,
  invoiceLine,
  invoiceReminder,
  job,
  orgCounter,
  payment,
  quote,
  quoteLine,
  serviceType,
  site,
  user,
} from "../schema";
import { definedOnly, likeEscape, toAddress } from "./util";

// Catalog, quotes, invoices, payments and reminders (FIN-01–07, EXP-04). Every query is scoped by organization
// first (RLS is the second layer). Numbers come from org_counter rows, which serialize concurrent issues. Local
// dates become instants in the organization's time zone.

const SORT = "-created_at";
const startOf = (date: string, tz: SQL) => sql`((${date}::date)::timestamp at time zone ${tz})`;
const endOf = (date: string, tz: SQL) => sql`(((${date}::date) + 1)::timestamp at time zone ${tz})`;

function toCatalogItem(r: typeof catalogItem.$inferSelect): CatalogItemRecord {
  return {
    id: r.id,
    kind: r.kind as CatalogItemKind,
    name: r.name,
    description: r.description,
    sku: r.sku,
    unit: r.unit,
    unitPriceMinor: r.unitPriceMinor,
    unitCostMinor: r.unitCostMinor,
    currency: r.currency as Currency,
    taxRateBps: r.taxRateBps,
    active: r.active,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toQuote(r: typeof quote.$inferSelect): QuoteRecord {
  return {
    id: r.id,
    number: r.number,
    customerId: r.customerId,
    siteId: r.siteId,
    contactId: r.contactId,
    serviceTypeId: r.serviceTypeId,
    jobId: r.jobId,
    title: r.title,
    notes: r.notes,
    status: r.status as QuoteStatus,
    currency: r.currency as Currency,
    discountType: r.discountType as DiscountType | null,
    discountValue: r.discountValue,
    subtotalMinor: r.subtotalMinor,
    discountMinor: r.discountMinor,
    taxMinor: r.taxMinor,
    totalMinor: r.totalMinor,
    validUntil: r.validUntil,
    sentAt: r.sentAt,
    viewedAt: r.viewedAt,
    decidedAt: r.decidedAt,
    decidedByContactId: r.decidedByContactId,
    decidedByUserId: r.decidedByUserId,
    declineReason: r.declineReason,
    createdBy: r.createdBy,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toInvoice(r: typeof invoice.$inferSelect): InvoiceRecord {
  return {
    id: r.id,
    number: r.number,
    customerId: r.customerId,
    siteId: r.siteId,
    jobId: r.jobId,
    quoteId: r.quoteId,
    contactId: r.contactId,
    status: r.status as InvoiceStatus,
    currency: r.currency as Currency,
    discountType: r.discountType as DiscountType | null,
    discountValue: r.discountValue,
    subtotalMinor: r.subtotalMinor,
    discountMinor: r.discountMinor,
    taxMinor: r.taxMinor,
    totalMinor: r.totalMinor,
    amountPaidMinor: r.amountPaidMinor,
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    notes: r.notes,
    sentAt: r.sentAt,
    viewedAt: r.viewedAt,
    paidAt: r.paidAt,
    voidedAt: r.voidedAt,
    voidReason: r.voidReason,
    createdBy: r.createdBy,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toLine(r: typeof quoteLine.$inferSelect | typeof invoiceLine.$inferSelect): QuoteLineRecord {
  return {
    id: r.id,
    position: r.position,
    kind: r.kind as LineKind,
    catalogItemId: r.catalogItemId,
    serviceTypeId: r.serviceTypeId,
    description: r.description,
    quantity: Number(r.quantity),
    unit: r.unit,
    unitPriceMinor: r.unitPriceMinor,
    taxRateBps: r.taxRateBps,
    netMinor: r.netMinor,
    taxMinor: r.taxMinor,
  };
}

function toInvoiceLine(r: typeof invoiceLine.$inferSelect): InvoiceLineRecord {
  return {
    ...toLine(r),
    expenseRequestId: r.expenseRequestId,
    unitCostMinor: r.unitCostMinor,
    markupBps: r.markupBps,
  };
}

export function billingRepo(tx: Tx, orgId: string): BillingRepo {
  const tz = sql`(select o.timezone from organization o where o.id = ${orgId})`;
  const decidedContact = alias(contact, "decided_contact");
  const decidedUser = alias(user, "decided_user");

  const partyColumns = {
    customerName: customer.name,
    site: {
      id: site.id,
      label: site.label,
      line1: site.line1,
      line2: site.line2,
      city: site.city,
      region: site.region,
      postalCode: site.postalCode,
      country: site.country,
    },
    contactName: contact.name,
    contactEmail: contact.email,
  };
  type PartyRow = {
    customerName: string;
    site: { [K in keyof typeof partyColumns.site]: string | null } | null;
    contactName: string | null;
    contactEmail: string | null;
  };
  const parties = (
    r: PartyRow,
    ids: { customerId: string; siteId: string | null; contactId: string | null },
  ): PartyRefs => ({
    customer: { id: ids.customerId, name: r.customerName },
    site:
      ids.siteId && r.site?.id
        ? {
            id: r.site.id,
            label: r.site.label!,
            address: toAddress({
              line1: r.site.line1!,
              line2: r.site.line2,
              city: r.site.city!,
              region: r.site.region,
              postalCode: r.site.postalCode,
              country: r.site.country!,
            }),
          }
        : null,
    contact:
      ids.contactId && r.contactName
        ? { id: ids.contactId, name: r.contactName, email: r.contactEmail }
        : null,
  });

  // ------------------------------------------------------------------ quotes

  const quoteBase = () =>
    tx
      .select({
        q: quote,
        ...partyColumns,
        serviceTypeName: serviceType.name,
        jobNumber: job.number,
        decidedContactName: decidedContact.name,
        decidedUserName: decidedUser.name,
      })
      .from(quote)
      .innerJoin(customer, and(eq(customer.id, quote.customerId), eq(customer.organizationId, orgId)))
      .leftJoin(site, and(eq(site.id, quote.siteId), eq(site.organizationId, orgId)))
      .leftJoin(contact, and(eq(contact.id, quote.contactId), eq(contact.organizationId, orgId)))
      .leftJoin(
        serviceType,
        and(eq(serviceType.id, quote.serviceTypeId), eq(serviceType.organizationId, orgId)),
      )
      .leftJoin(job, and(eq(job.id, quote.jobId), eq(job.organizationId, orgId)))
      .leftJoin(
        decidedContact,
        and(eq(decidedContact.id, quote.decidedByContactId), eq(decidedContact.organizationId, orgId)),
      )
      .leftJoin(decidedUser, eq(decidedUser.id, quote.decidedByUserId));
  type QuoteRow = Awaited<ReturnType<ReturnType<typeof quoteBase>["execute"]>>[number];
  const toQuoteRow = (r: QuoteRow): QuoteListRow => {
    const q = toQuote(r.q);
    return {
      ...q,
      ...parties(r, q),
      serviceType:
        q.serviceTypeId && r.serviceTypeName ? { id: q.serviceTypeId, name: r.serviceTypeName } : null,
      job: q.jobId && r.jobNumber !== null ? { id: q.jobId, number: r.jobNumber } : null,
      decidedByName: r.decidedContactName ?? r.decidedUserName ?? null,
    };
  };
  const quoteScope = and(eq(quote.organizationId, orgId), isNull(quote.deletedAt));

  async function quoteView(where: SQL | undefined): Promise<QuoteView | null> {
    const [r] = await quoteBase().where(and(quoteScope, where)).limit(1);
    if (!r) return null;
    const lines = await tx
      .select()
      .from(quoteLine)
      .where(and(eq(quoteLine.organizationId, orgId), eq(quoteLine.quoteId, r.q.id)))
      .orderBy(asc(quoteLine.position));
    return { ...toQuoteRow(r), lines: lines.map(toLine) };
  }

  const quoteLineRows = (quoteId: string, lines: NewQuoteLine[]) =>
    lines.map((l) => ({ ...l, organizationId: orgId, quoteId }));

  // ------------------------------------------------------------------ invoices

  const invoiceBase = () =>
    tx
      .select({
        i: invoice,
        ...partyColumns,
        jobNumber: job.number,
        jobTitle: job.title,
        quoteNumber: quote.number,
      })
      .from(invoice)
      .innerJoin(customer, and(eq(customer.id, invoice.customerId), eq(customer.organizationId, orgId)))
      .leftJoin(site, and(eq(site.id, invoice.siteId), eq(site.organizationId, orgId)))
      .leftJoin(contact, and(eq(contact.id, invoice.contactId), eq(contact.organizationId, orgId)))
      .leftJoin(job, and(eq(job.id, invoice.jobId), eq(job.organizationId, orgId)))
      .leftJoin(quote, and(eq(quote.id, invoice.quoteId), eq(quote.organizationId, orgId)));
  type InvoiceRow = Awaited<ReturnType<ReturnType<typeof invoiceBase>["execute"]>>[number];
  const toInvoiceRow = (r: InvoiceRow): InvoiceListRow => {
    const i = toInvoice(r.i);
    return {
      ...i,
      ...parties(r, i),
      job:
        i.jobId && r.jobNumber !== null
          ? { id: i.jobId, number: r.jobNumber, title: r.jobTitle ?? "" }
          : null,
      quote: i.quoteId && r.quoteNumber ? { id: i.quoteId, number: r.quoteNumber } : null,
    };
  };
  const invoiceScope = and(eq(invoice.organizationId, orgId), isNull(invoice.deletedAt));

  async function paymentsOf(where: SQL): Promise<PaymentRecord[]> {
    const rows = await tx
      .select({ p: payment, recorderName: user.name })
      .from(payment)
      .leftJoin(user, eq(user.id, payment.recordedBy))
      .where(and(eq(payment.organizationId, orgId), where))
      .orderBy(asc(payment.paidAt), asc(payment.id));
    return rows.map(({ p, recorderName }) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amountMinor: p.amountMinor,
      currency: p.currency as Currency,
      method: p.method as PaymentMethod,
      provider: p.provider,
      providerRef: p.providerRef,
      reference: p.reference,
      note: p.note,
      paidAt: p.paidAt,
      recordedBy: p.recordedBy && recorderName ? { id: p.recordedBy, name: recorderName } : null,
      createdAt: p.createdAt,
    }));
  }

  const invoiceLineRows = (invoiceId: string, lines: NewInvoiceLine[]) =>
    lines.map((l) => ({ ...l, organizationId: orgId, invoiceId }));

  function guardOf<S extends string>(
    table: typeof quote | typeof invoice,
    id: string,
    guard?: UpdateGuard<S>,
  ): SQL | undefined {
    return and(
      eq(table.organizationId, orgId),
      eq(table.id, id),
      isNull(table.deletedAt),
      guard?.expectedVersion !== undefined ? eq(table.version, guard.expectedVersion) : undefined,
      guard?.fromStatuses ? inArray(table.status, [...guard.fromStatuses]) : undefined,
    );
  }

  /** Created-at range, keyset cursor or offset page, and the total for offset pages. */
  async function paged<R extends { id: string; createdAt: Date }>(
    f: { limit: number; page?: number; cursor?: string },
    createdAt: typeof quote.createdAt | typeof invoice.createdAt,
    idCol: typeof quote.id | typeof invoice.id,
    where: (SQL | undefined)[],
    run: (condition: SQL | undefined, offset: number) => Promise<R[]>,
    count: (condition: SQL | undefined) => Promise<number>,
  ) {
    if (f.cursor && !f.page) {
      const [at, id] = decodeCursor(f.cursor, SORT).v as [string, string];
      where.push(sql`(${createdAt}, ${idCol}) < (${new Date(at)}, ${id})`);
    }
    const condition = and(...where);
    const offset = f.page ? (f.page - 1) * f.limit : 0;
    const rows = await run(condition, offset);
    const hasMore = rows.length > f.limit;
    const page = rows.slice(0, f.limit);
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        hasMore && last && !f.page
          ? encodeCursor({ s: SORT, v: [last.createdAt.toISOString(), last.id] })
          : null,
      total: f.page ? await count(condition) : null,
    };
  }

  return {
    async nextCounter(name) {
      const [r] = await tx
        .insert(orgCounter)
        .values({ organizationId: orgId, name, value: 1 })
        .onConflictDoUpdate({
          target: [orgCounter.organizationId, orgCounter.name],
          set: { value: sql`${orgCounter.value} + 1` },
        })
        .returning({ value: orgCounter.value });
      return r!.value;
    },

    // ---------------------------------------------------------------- catalog
    async listCatalog(f) {
      const where: (SQL | undefined)[] = [eq(catalogItem.organizationId, orgId)];
      if (!f.includeInactive) where.push(eq(catalogItem.active, true));
      if (f.kind) where.push(eq(catalogItem.kind, f.kind));
      if (f.q) {
        const q = `%${likeEscape(f.q)}%`;
        where.push(or(ilike(catalogItem.name, q), ilike(catalogItem.sku, q)));
      }
      const rows = await tx
        .select()
        .from(catalogItem)
        .where(and(...where))
        .orderBy(asc(catalogItem.name), asc(catalogItem.id))
        .limit(f.limit);
      return rows.map(toCatalogItem);
    },
    async getCatalogItem(id) {
      const [r] = await tx
        .select()
        .from(catalogItem)
        .where(and(eq(catalogItem.organizationId, orgId), eq(catalogItem.id, id)));
      return r ? toCatalogItem(r) : null;
    },
    async findCatalogItemBySku(sku) {
      const [r] = await tx
        .select()
        .from(catalogItem)
        .where(and(eq(catalogItem.organizationId, orgId), eq(catalogItem.sku, sku)));
      return r ? toCatalogItem(r) : null;
    },
    async createCatalogItem(data) {
      const [r] = await tx
        .insert(catalogItem)
        .values({ ...data, organizationId: orgId })
        .returning();
      return toCatalogItem(r!);
    },
    async updateCatalogItem(id, patch) {
      const [r] = await tx
        .update(catalogItem)
        .set({ ...definedOnly(patch), updatedAt: new Date() })
        .where(and(eq(catalogItem.organizationId, orgId), eq(catalogItem.id, id)))
        .returning();
      return r ? toCatalogItem(r) : null;
    },

    // ---------------------------------------------------------------- quotes
    async listQuotes(f) {
      const where: (SQL | undefined)[] = [quoteScope];
      if (f.status?.length) where.push(inArray(quote.status, f.status));
      if (f.customer) where.push(eq(quote.customerId, f.customer));
      if (f.job) where.push(eq(quote.jobId, f.job));
      if (f.from) where.push(sql`${quote.createdAt} >= ${startOf(f.from, tz)}`);
      if (f.to) where.push(sql`${quote.createdAt} < ${endOf(f.to, tz)}`);
      if (f.q) {
        const q = `%${likeEscape(f.q)}%`;
        where.push(or(ilike(quote.number, q), ilike(quote.title, q), ilike(customer.name, q)));
      }
      return paged(
        f,
        quote.createdAt,
        quote.id,
        where,
        async (condition, offset) =>
          (
            await quoteBase()
              .where(condition)
              .orderBy(desc(quote.createdAt), desc(quote.id))
              .limit(f.limit + 1)
              .offset(offset)
          ).map(toQuoteRow),
        async (condition) => {
          const [t] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(quote)
            .innerJoin(customer, and(eq(customer.id, quote.customerId), eq(customer.organizationId, orgId)))
            .where(condition);
          return t?.n ?? 0;
        },
      );
    },
    getQuote: (id) => quoteView(eq(quote.id, id)),
    getQuoteByNumber: (number) => quoteView(eq(quote.number, number)),
    async createQuote(data, lines) {
      const [r] = await tx
        .insert(quote)
        .values({ ...data, organizationId: orgId })
        .returning();
      if (lines.length) await tx.insert(quoteLine).values(quoteLineRows(r!.id, lines));
      return toQuote(r!);
    },
    async updateQuote(id, patch, guard) {
      const [r] = await tx
        .update(quote)
        .set({ ...definedOnly(patch), version: sql`${quote.version} + 1`, updatedAt: new Date() })
        .where(guardOf(quote, id, guard))
        .returning();
      return r ? toQuote(r) : null;
    },
    async replaceQuoteLines(quoteId, lines) {
      await tx
        .delete(quoteLine)
        .where(and(eq(quoteLine.organizationId, orgId), eq(quoteLine.quoteId, quoteId)));
      if (lines.length) await tx.insert(quoteLine).values(quoteLineRows(quoteId, lines));
    },
    async quoteForJob(jobId) {
      const [r] = await quoteBase()
        .where(and(quoteScope, eq(quote.jobId, jobId)))
        .orderBy(desc(quote.createdAt))
        .limit(1);
      return r ? toQuoteRow(r) : null;
    },
    async expireQuotes(today) {
      const rows = await tx
        .update(quote)
        .set({ status: "expired", version: sql`${quote.version} + 1`, updatedAt: new Date() })
        .where(and(quoteScope, eq(quote.status, "sent"), sql`${quote.validUntil} < ${today}::date`))
        .returning({ id: quote.id });
      return rows.map((r) => r.id);
    },

    // ---------------------------------------------------------------- invoices
    async listInvoices(f) {
      const where: (SQL | undefined)[] = [invoiceScope];
      if (f.status?.length) where.push(inArray(invoice.status, f.status));
      if (f.customer) where.push(eq(invoice.customerId, f.customer));
      if (f.job) where.push(eq(invoice.jobId, f.job));
      if (f.from) where.push(sql`${invoice.issueDate} >= ${f.from}::date`);
      if (f.to) where.push(sql`${invoice.issueDate} <= ${f.to}::date`);
      if (f.q) {
        const q = `%${likeEscape(f.q)}%`;
        where.push(or(ilike(invoice.number, q), ilike(customer.name, q), ilike(job.title, q)));
      }
      return paged(
        f,
        invoice.createdAt,
        invoice.id,
        where,
        async (condition, offset) =>
          (
            await invoiceBase()
              .where(condition)
              .orderBy(desc(invoice.createdAt), desc(invoice.id))
              .limit(f.limit + 1)
              .offset(offset)
          ).map(toInvoiceRow),
        async (condition) => {
          const [t] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(invoice)
            .innerJoin(customer, and(eq(customer.id, invoice.customerId), eq(customer.organizationId, orgId)))
            .leftJoin(job, and(eq(job.id, invoice.jobId), eq(job.organizationId, orgId)))
            .where(condition);
          return t?.n ?? 0;
        },
      );
    },
    async getInvoice(id): Promise<InvoiceView | null> {
      const [r] = await invoiceBase()
        .where(and(invoiceScope, eq(invoice.id, id)))
        .limit(1);
      if (!r) return null;
      const lines = await tx
        .select()
        .from(invoiceLine)
        .where(and(eq(invoiceLine.organizationId, orgId), eq(invoiceLine.invoiceId, id)))
        .orderBy(asc(invoiceLine.position));
      return {
        ...toInvoiceRow(r),
        lines: lines.map(toInvoiceLine),
        payments: await paymentsOf(eq(payment.invoiceId, id)),
      };
    },
    async createInvoice(data, lines) {
      const [r] = await tx
        .insert(invoice)
        .values({ ...data, organizationId: orgId })
        .returning();
      if (lines.length) await tx.insert(invoiceLine).values(invoiceLineRows(r!.id, lines));
      return toInvoice(r!);
    },
    async updateInvoice(id, patch, guard) {
      const [r] = await tx
        .update(invoice)
        .set({ ...definedOnly(patch), version: sql`${invoice.version} + 1`, updatedAt: new Date() })
        .where(guardOf(invoice, id, guard))
        .returning();
      return r ? toInvoice(r) : null;
    },
    async replaceInvoiceLines(invoiceId, lines) {
      await tx
        .delete(invoiceLine)
        .where(and(eq(invoiceLine.organizationId, orgId), eq(invoiceLine.invoiceId, invoiceId)));
      if (lines.length) await tx.insert(invoiceLine).values(invoiceLineRows(invoiceId, lines));
    },
    async billedExpenseIds(expenseIds, exceptInvoiceId) {
      if (expenseIds.length === 0) return [];
      // Lock the requests first: two invoices billing the same part wait for each other (EXP-04).
      await tx
        .select({ id: expenseRequest.id })
        .from(expenseRequest)
        .where(and(eq(expenseRequest.organizationId, orgId), inArray(expenseRequest.id, expenseIds)))
        .orderBy(asc(expenseRequest.id))
        .for("update");
      const rows = await tx
        .selectDistinct({ id: invoiceLine.expenseRequestId })
        .from(invoiceLine)
        .innerJoin(invoice, and(eq(invoice.id, invoiceLine.invoiceId), eq(invoice.organizationId, orgId)))
        .where(
          and(
            eq(invoiceLine.organizationId, orgId),
            inArray(invoiceLine.expenseRequestId, expenseIds),
            ne(invoice.status, "void"),
            isNull(invoice.deletedAt),
            exceptInvoiceId ? ne(invoice.id, exceptInvoiceId) : undefined,
          ),
        );
      return rows.map((r) => r.id!);
    },
    async receivables(asOf) {
      const res = await tx.execute<Record<string, unknown>>(sql`
        with open as (
          select i.due_date,
                 i.total_minor - coalesce((
                   select sum(p.amount_minor) from payment p
                    where p.organization_id = ${orgId} and p.invoice_id = i.id and p.paid_at < ${endOf(asOf, tz)}
                 ), 0) as balance
            from invoice i
           where i.organization_id = ${orgId} and i.deleted_at is null and i.number is not null
             and i.issue_date <= ${asOf}::date
             and (i.voided_at is null or i.voided_at >= ${endOf(asOf, tz)})
        )
        select coalesce(sum(balance) filter (where balance > 0), 0)::bigint as outstanding,
               (count(*) filter (where balance > 0))::int as outstanding_count,
               coalesce(sum(balance) filter (where balance > 0 and due_date < ${asOf}::date), 0)::bigint as overdue,
               (count(*) filter (where balance > 0 and due_date < ${asOf}::date))::int as overdue_count
          from open`);
      const r = res.rows[0]!;
      return {
        outstandingMinor: Number(r.outstanding),
        outstandingCount: Number(r.outstanding_count),
        overdueMinor: Number(r.overdue),
        overdueCount: Number(r.overdue_count),
      };
    },

    // ---------------------------------------------------------------- payments
    async applyPaymentToInvoice(invoiceId, amountMinor, paidAt) {
      const settles = sql`${invoice.amountPaidMinor} + ${amountMinor} >= ${invoice.totalMinor}`;
      const [r] = await tx
        .update(invoice)
        .set({
          amountPaidMinor: sql`${invoice.amountPaidMinor} + ${amountMinor}`,
          status: sql`case when ${settles} then 'paid' else ${invoice.status} end`,
          paidAt: sql`case when ${settles} then ${paidAt}::timestamptz else ${invoice.paidAt} end`,
          version: sql`${invoice.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            invoiceScope,
            eq(invoice.id, invoiceId),
            inArray(invoice.status, ["sent", "overdue"]),
            sql`${invoice.amountPaidMinor} + ${amountMinor} <= ${invoice.totalMinor}`,
          ),
        )
        .returning();
      return r ? toInvoice(r) : null;
    },
    async addPayment(data) {
      const { recordedByUserId, ...rest } = data;
      const [r] = await tx
        .insert(payment)
        .values({ ...rest, recordedBy: recordedByUserId, organizationId: orgId })
        .returning({ id: payment.id });
      return (await paymentsOf(eq(payment.id, r!.id)))[0]!;
    },
    async findPayment(provider, providerRef) {
      const [p] = await paymentsOf(
        and(eq(payment.provider, provider), eq(payment.providerRef, providerRef))!,
      );
      return p ?? null;
    },

    // ---------------------------------------------------------------- overdue and reminders
    async markOverdue(today) {
      const rows = await tx
        .update(invoice)
        .set({ status: "overdue", version: sql`${invoice.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            invoiceScope,
            eq(invoice.status, "sent"),
            sql`${invoice.dueDate} < ${today}::date`,
            sql`${invoice.totalMinor} > ${invoice.amountPaidMinor}`,
          ),
        )
        .returning({ id: invoice.id });
      return rows.map((r) => r.id);
    },
    async reminderCandidates() {
      const rows = await tx
        .select({
          invoiceId: invoice.id,
          dueDate: invoice.dueDate,
          sentStages: sql<number[]>`coalesce((
            select array_agg(r.stage order by r.stage) from ${invoiceReminder} r
             where r.organization_id = ${orgId} and r.invoice_id = ${invoice.id}
          ), '{}')`,
        })
        .from(invoice)
        .innerJoin(contact, and(eq(contact.id, invoice.contactId), eq(contact.organizationId, orgId)))
        .where(
          and(
            invoiceScope,
            eq(invoice.status, "overdue"),
            sql`${invoice.totalMinor} > ${invoice.amountPaidMinor}`,
            sql`${invoice.dueDate} is not null`,
            sql`${contact.email} is not null`,
          ),
        )
        .orderBy(asc(invoice.dueDate), asc(invoice.id));
      return rows.map((r) => ({
        invoiceId: r.invoiceId,
        dueDate: r.dueDate!,
        sentStages: r.sentStages.map(Number),
      }));
    },
    async recordReminder(invoiceId, stage, at) {
      const rows = await tx
        .insert(invoiceReminder)
        .values({ organizationId: orgId, invoiceId, stage, sentAt: at })
        .onConflictDoNothing()
        .returning({ stage: invoiceReminder.stage });
      return rows.length > 0;
    },

    // ---------------------------------------------------------------- revenue
    async revenueTotals(f) {
      const res = await tx.execute<Record<string, unknown>>(sql`
        select i.invoiced, i.invoiced_count, p.collected, p.payment_count
          from (
            select coalesce(sum(total_minor), 0)::bigint as invoiced, count(*)::int as invoiced_count
              from invoice
             where organization_id = ${orgId} and deleted_at is null and number is not null and status <> 'void'
               and issue_date >= ${f.from}::date and issue_date <= ${f.to}::date
          ) i, (
            select coalesce(sum(amount_minor), 0)::bigint as collected, count(*)::int as payment_count
              from payment
             where organization_id = ${orgId}
               and paid_at >= ${startOf(f.from, sql`${f.timeZone}`)} and paid_at < ${endOf(f.to, sql`${f.timeZone}`)}
          ) p`);
      const r = res.rows[0]!;
      return {
        invoicedMinor: Number(r.invoiced),
        invoicedCount: Number(r.invoiced_count),
        collectedMinor: Number(r.collected),
        paymentCount: Number(r.payment_count),
      };
    },
    async revenueSeries(f, bucket) {
      const unit = sql.raw(bucket === "week" ? "'week'" : "'day'");
      const zone = sql`${f.timeZone}`;
      const res = await tx.execute<{ bucket: string; invoiced: string; collected: string }>(sql`
        select bucket, sum(invoiced)::bigint as invoiced, sum(collected)::bigint as collected
          from (
            select to_char(date_trunc(${unit}, issue_date::timestamp), 'YYYY-MM-DD') as bucket,
                   total_minor as invoiced, 0 as collected
              from invoice
             where organization_id = ${orgId} and deleted_at is null and number is not null and status <> 'void'
               and issue_date >= ${f.from}::date and issue_date <= ${f.to}::date
            union all
            select to_char(date_trunc(${unit}, paid_at at time zone ${zone}), 'YYYY-MM-DD'), 0, amount_minor
              from payment
             where organization_id = ${orgId}
               and paid_at >= ${startOf(f.from, zone)} and paid_at < ${endOf(f.to, zone)}
          ) x
         group by bucket
         order by bucket`);
      return res.rows.map((r) => ({
        bucket: r.bucket,
        invoicedMinor: Number(r.invoiced),
        collectedMinor: Number(r.collected),
      }));
    },

    async queueEmail(email) {
      await tx.insert(emailOutbox).values({
        organizationId: orgId,
        toEmail: email.toEmail.toLowerCase(),
        subject: email.subject,
        html: email.html,
        text: email.text,
        kind: email.kind,
        status: email.captured ? "captured" : "queued",
      });
    },
  };
}
