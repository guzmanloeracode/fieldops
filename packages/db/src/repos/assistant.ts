import type {
  AssistantConversationRecord,
  AssistantMessageRecord,
  AssistantRepo,
  RevenueBreakdownRow,
} from "@fieldops/core";
import {
  ASSISTANT_RETENTION_DAYS,
  type AssistantRole,
  type AssistantToolRun,
  type InvoiceStatus,
} from "@fieldops/shared";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Database, Tx } from "../client";
import { assistantConversation, assistantMessage } from "../schema";

// Ask FieldOps (AI-02): conversations private to their user, and the billing reads behind the revenue_summary and
// customer_history tools. Every query filters by organization_id (RLS is the second layer). Revenue follows the
// dashboard's definitions: invoiced = invoices issued in the period and not void, collected = payments received in
// the period, outstanding = the open balance of sent and overdue invoices now.

function toConversation(r: typeof assistantConversation.$inferSelect): AssistantConversationRecord {
  return { id: r.id, userId: r.userId, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

function toMessage(r: typeof assistantMessage.$inferSelect): AssistantMessageRecord {
  return {
    id: r.id,
    conversationId: r.conversationId,
    role: r.role as AssistantRole,
    content: r.content,
    tools: (Array.isArray(r.tools) ? r.tools : []) as AssistantToolRun[],
    aiInteractionId: r.aiInteractionId,
    createdAt: r.createdAt,
  };
}

const num = (v: unknown) => Number(v ?? 0);

export function assistantRepo(tx: Tx, orgId: string): AssistantRepo {
  const conv = (id: string, userId: string) =>
    and(
      eq(assistantConversation.organizationId, orgId),
      eq(assistantConversation.id, id),
      eq(assistantConversation.userId, userId),
    );
  return {
    async createConversation({ userId, title }) {
      const [r] = await tx
        .insert(assistantConversation)
        .values({ organizationId: orgId, userId, title })
        .returning();
      return toConversation(r!);
    },

    async getConversation(id, userId) {
      const [r] = await tx.select().from(assistantConversation).where(conv(id, userId));
      return r ? toConversation(r) : null;
    },

    async listConversations(userId, { since, limit }) {
      const rows = await tx
        .select()
        .from(assistantConversation)
        .where(
          and(
            eq(assistantConversation.organizationId, orgId),
            eq(assistantConversation.userId, userId),
            gte(assistantConversation.updatedAt, since),
          ),
        )
        .orderBy(desc(assistantConversation.updatedAt), desc(assistantConversation.id))
        .limit(limit);
      return rows.map(toConversation);
    },

    async deleteConversation(id, userId) {
      // Messages go with it (on delete cascade).
      const rows = await tx
        .delete(assistantConversation)
        .where(conv(id, userId))
        .returning({ id: assistantConversation.id });
      return rows.length > 0;
    },

    async touchConversation(id) {
      await tx
        .update(assistantConversation)
        .set({ updatedAt: sql`now()` })
        .where(and(eq(assistantConversation.organizationId, orgId), eq(assistantConversation.id, id)));
    },

    async addMessage(m) {
      const [r] = await tx
        .insert(assistantMessage)
        .values({
          organizationId: orgId,
          conversationId: m.conversationId,
          role: m.role,
          content: m.content,
          tools: m.tools,
          aiInteractionId: m.aiInteractionId,
        })
        .returning();
      return toMessage(r!);
    },

    async listMessages(conversationId, opts) {
      const where = and(
        eq(assistantMessage.organizationId, orgId),
        eq(assistantMessage.conversationId, conversationId),
      );
      if (opts?.last) {
        const rows = await tx
          .select()
          .from(assistantMessage)
          .where(where)
          .orderBy(desc(assistantMessage.createdAt), desc(assistantMessage.id))
          .limit(opts.last);
        return rows.reverse().map(toMessage);
      }
      const rows = await tx
        .select()
        .from(assistantMessage)
        .where(where)
        .orderBy(asc(assistantMessage.createdAt), asc(assistantMessage.id));
      return rows.map(toMessage);
    },

    async revenue(q) {
      const tz = q.timeZone;
      const start = sql`(${q.from}::date)::timestamp at time zone ${tz}`;
      const end = sql`((${q.to}::date) + 1)::timestamp at time zone ${tz}`;
      const issued = sql`i.organization_id = ${orgId} and i.deleted_at is null and i.number is not null
        and i.status not in ('draft', 'void') and i.issue_date between ${q.from}::date and ${q.to}::date`;
      const paid = sql`p.organization_id = ${orgId} and i.deleted_at is null
        and p.paid_at >= ${start} and p.paid_at < ${end}`;
      const [inv] = (
        await tx.execute(sql`select coalesce(sum(i.total_minor), 0) as total, count(*) as n, min(i.currency) as currency
          from invoice i where ${issued}`)
      ).rows as { total: unknown; n: unknown; currency: string | null }[];
      const [pay] = (
        await tx.execute(sql`select coalesce(sum(p.amount_minor), 0) as total, count(*) as n
          from payment p join invoice i on i.id = p.invoice_id and i.organization_id = p.organization_id
          where ${paid}`)
      ).rows as { total: unknown; n: unknown }[];
      const [open] = (
        await tx.execute(sql`select
            coalesce(sum(i.total_minor - i.amount_paid_minor), 0) as balance,
            coalesce(sum(case when i.status = 'overdue' or i.due_date < ${q.today}::date
              then i.total_minor - i.amount_paid_minor else 0 end), 0) as overdue,
            count(*) as n
          from invoice i
          where i.organization_id = ${orgId} and i.deleted_at is null and i.number is not null
            and i.status in ('sent', 'overdue') and i.total_minor > i.amount_paid_minor`)
      ).rows as { balance: unknown; overdue: unknown; n: unknown }[];

      const rows = new Map<string, RevenueBreakdownRow>();
      const add = (key: string, label: string, field: "invoicedMinor" | "collectedMinor", v: unknown) => {
        const r = rows.get(key) ?? { key, label, invoicedMinor: 0, collectedMinor: 0 };
        r[field] += num(v);
        rows.set(key, r);
      };
      if (q.groupBy === "month") {
        const a = await tx.execute(sql`select to_char(i.issue_date, 'YYYY-MM') as k, sum(i.total_minor) as v
          from invoice i where ${issued} group by 1`);
        for (const r of a.rows as { k: string; v: unknown }[]) add(r.k, r.k, "invoicedMinor", r.v);
        const b = await tx.execute(sql`select to_char(p.paid_at at time zone ${tz}, 'YYYY-MM') as k,
            sum(p.amount_minor) as v
          from payment p join invoice i on i.id = p.invoice_id and i.organization_id = p.organization_id
          where ${paid} group by 1`);
        for (const r of b.rows as { k: string; v: unknown }[]) add(r.k, r.k, "collectedMinor", r.v);
      } else if (q.groupBy === "service_type") {
        const type = sql`left join job j on j.id = i.job_id and j.organization_id = i.organization_id
          left join service_type st on st.id = j.service_type_id and st.organization_id = i.organization_id`;
        const a = await tx.execute(sql`select coalesce(st.id::text, 'none') as k,
            coalesce(min(st.name), 'No service type') as l, sum(i.total_minor) as v
          from invoice i ${type} where ${issued} group by 1`);
        for (const r of a.rows as { k: string; l: string; v: unknown }[]) add(r.k, r.l, "invoicedMinor", r.v);
        const b = await tx.execute(sql`select coalesce(st.id::text, 'none') as k,
            coalesce(min(st.name), 'No service type') as l, sum(p.amount_minor) as v
          from payment p join invoice i on i.id = p.invoice_id and i.organization_id = p.organization_id
          ${type} where ${paid} group by 1`);
        for (const r of b.rows as { k: string; l: string; v: unknown }[])
          add(r.k, r.l, "collectedMinor", r.v);
      }
      return {
        currency: inv?.currency ?? null,
        totals: {
          invoicedMinor: num(inv?.total),
          invoiceCount: num(inv?.n),
          collectedMinor: num(pay?.total),
          paymentCount: num(pay?.n),
          outstandingMinor: num(open?.balance),
          overdueMinor: num(open?.overdue),
          openInvoiceCount: num(open?.n),
        },
        rows: [...rows.values()].sort((x, y) =>
          q.groupBy === "month"
            ? x.key.localeCompare(y.key)
            : y.invoicedMinor - x.invoicedMinor || x.label.localeCompare(y.label),
        ),
      };
    },

    async openInvoices(customerId, limit) {
      const res = await tx.execute(sql`select i.id, i.number, i.status, i.total_minor,
          i.total_minor - i.amount_paid_minor as balance, i.currency, i.issue_date::text as issue_date,
          i.due_date::text as due_date
        from invoice i
        where i.organization_id = ${orgId} and i.customer_id = ${customerId} and i.deleted_at is null
          and i.number is not null and i.status in ('sent', 'overdue') and i.total_minor > i.amount_paid_minor
        order by i.due_date asc nulls last, i.number
        limit ${limit}`);
      return (
        res.rows as {
          id: string;
          number: string;
          status: string;
          total_minor: unknown;
          balance: unknown;
          currency: string;
          issue_date: string | null;
          due_date: string | null;
        }[]
      ).map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status as InvoiceStatus,
        totalMinor: num(r.total_minor),
        balanceMinor: num(r.balance),
        currency: r.currency,
        issueDate: r.issue_date,
        dueDate: r.due_date,
      }));
    },
  };
}

/**
 * Retention (PRD §9.3): deletes messages older than 30 days and conversations unused for 30 days, in every
 * organization. Runs as the owner role in the worker's maintenance job.
 */
export async function deleteExpiredConversations(
  db: Database,
  now: Date = new Date(),
): Promise<{ conversations: number; messages: number }> {
  const cutoff = new Date(now.getTime() - ASSISTANT_RETENTION_DAYS * 86_400_000);
  return db.transaction(async (tx) => {
    const messages = await tx
      .delete(assistantMessage)
      .where(lt(assistantMessage.createdAt, cutoff))
      .returning({ id: assistantMessage.id });
    const conversations = await tx
      .delete(assistantConversation)
      .where(lt(assistantConversation.updatedAt, cutoff))
      .returning({ id: assistantConversation.id });
    return { conversations: conversations.length, messages: messages.length };
  });
}
