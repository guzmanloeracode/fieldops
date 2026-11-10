import type { InvoiceStatus } from "@fieldops/shared";
import type { MemoryData } from "./memory-store";
import type {
  AssistantConversationRecord,
  AssistantMessageRecord,
  OpenInvoiceRow,
  RevenueBreakdownRow,
} from "../services/assistant-types";
import type { Store } from "../services/types";

/** Billing rows the revenue tool reads; tests push them in (the billing slice owns the real tables). */
export interface MemoryInvoice {
  id: string;
  number: string | null;
  customerId: string;
  status: InvoiceStatus;
  totalMinor: number;
  amountPaidMinor: number;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  serviceTypeId: string | null;
}

export interface MemoryPayment {
  invoiceId: string;
  amountMinor: number;
  /** Local date of the payment, for simplicity. */
  paidOn: string;
}

export interface MemoryAssistant {
  conversations: AssistantConversationRecord[];
  messages: AssistantMessageRecord[];
  invoices: MemoryInvoice[];
  payments: MemoryPayment[];
}

/** The assistant's state in a memory store, created on first use. */
export function assistantData(data: MemoryData): MemoryAssistant {
  const d = data as MemoryData & { assistant?: MemoryAssistant };
  d.assistant ??= { conversations: [], messages: [], invoices: [], payments: [] };
  return d.assistant;
}

/** In-memory Ask FieldOps conversations and the billing reads of its tools (AI-02). */
export function memoryAssistant(data: MemoryData, uuid: () => string): Pick<Store, "assistant"> {
  const a = () => assistantData(data);
  let tick = 0;
  // Strictly increasing timestamps, so "most recent first" is deterministic within one test.
  const now = () => new Date(Date.UTC(2026, 10, 10, 9) + ++tick * 1000);
  const open = (i: MemoryInvoice) => (i.status === "sent" || i.status === "overdue") && i.number !== null;
  return {
    assistant: {
      async createConversation({ userId, title }) {
        const at = now();
        const c = { id: uuid(), userId, title, createdAt: at, updatedAt: at };
        a().conversations.push(c);
        return c;
      },
      async getConversation(id, userId) {
        return a().conversations.find((c) => c.id === id && c.userId === userId) ?? null;
      },
      async listConversations(userId, { since, limit }) {
        return a()
          .conversations.filter((c) => c.userId === userId && c.updatedAt >= since)
          .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())
          .slice(0, limit);
      },
      async deleteConversation(id, userId) {
        const before = a().conversations.length;
        a().conversations = a().conversations.filter((c) => !(c.id === id && c.userId === userId));
        if (a().conversations.length === before) return false;
        a().messages = a().messages.filter((m) => m.conversationId !== id);
        return true;
      },
      async touchConversation(id) {
        const c = a().conversations.find((x) => x.id === id);
        if (c) c.updatedAt = now();
      },
      async addMessage(input) {
        const m = { ...input, id: uuid(), createdAt: now() };
        a().messages.push(m);
        return m;
      },
      async listMessages(conversationId, opts) {
        const all = a().messages.filter((m) => m.conversationId === conversationId);
        return opts?.last ? all.slice(-opts.last) : all;
      },
      async revenue(q) {
        const issued = a().invoices.filter(
          (i) =>
            i.number && i.status !== "void" && i.issueDate && i.issueDate >= q.from && i.issueDate <= q.to,
        );
        const paid = a().payments.filter((p) => p.paidOn >= q.from && p.paidOn <= q.to);
        const openRows = a().invoices.filter(open);
        const balance = (i: MemoryInvoice) => i.totalMinor - i.amountPaidMinor;
        const rows = new Map<string, RevenueBreakdownRow>();
        const keyOf = (i: MemoryInvoice | undefined, date: string) =>
          q.groupBy === "month" ? date.slice(0, 7) : (i?.serviceTypeId ?? "none");
        const row = (key: string) => {
          let r = rows.get(key);
          if (!r) {
            const label =
              q.groupBy === "month"
                ? key
                : (data.serviceTypes.find((t) => t.id === key)?.name ?? "No service type");
            r = { key, label, invoicedMinor: 0, collectedMinor: 0 };
            rows.set(key, r);
          }
          return r;
        };
        if (q.groupBy) {
          for (const i of issued) row(keyOf(i, i.issueDate!)).invoicedMinor += i.totalMinor;
          for (const p of paid) {
            row(
              keyOf(
                a().invoices.find((i) => i.id === p.invoiceId),
                p.paidOn,
              ),
            ).collectedMinor += p.amountMinor;
          }
        }
        return {
          currency: a().invoices[0]?.currency ?? null,
          totals: {
            invoicedMinor: issued.reduce((n, i) => n + i.totalMinor, 0),
            invoiceCount: issued.length,
            collectedMinor: paid.reduce((n, p) => n + p.amountMinor, 0),
            paymentCount: paid.length,
            outstandingMinor: openRows.reduce((n, i) => n + balance(i), 0),
            overdueMinor: openRows
              .filter((i) => i.status === "overdue" || (i.dueDate !== null && i.dueDate < q.today))
              .reduce((n, i) => n + balance(i), 0),
            openInvoiceCount: openRows.length,
          },
          rows: [...rows.values()].sort((x, y) => x.key.localeCompare(y.key)),
        };
      },
      async openInvoices(customerId, limit): Promise<OpenInvoiceRow[]> {
        return a()
          .invoices.filter((i) => i.customerId === customerId && open(i) && i.totalMinor > i.amountPaidMinor)
          .sort((x, y) => (x.dueDate ?? "").localeCompare(y.dueDate ?? ""))
          .slice(0, limit)
          .map((i) => ({
            id: i.id,
            number: i.number!,
            status: i.status,
            totalMinor: i.totalMinor,
            balanceMinor: i.totalMinor - i.amountPaidMinor,
            currency: i.currency,
            issueDate: i.issueDate,
            dueDate: i.dueDate,
          }));
      },
    },
  };
}
