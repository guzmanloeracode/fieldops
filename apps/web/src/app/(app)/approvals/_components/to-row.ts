import "server-only";
import {
  expenses,
  formatJobNumber,
  type Actor,
  type ExpenseView,
  type OrganizationSettings,
} from "@fieldops/core";
import { formatRelative } from "@/lib/format";
import type { ExpenseRow } from "./expense-row";

/** Maps expenses to client rows, with what the viewer may do on each (decided by core permission rules). */
export function toExpenseRows(
  rows: ExpenseView[],
  opts: {
    actor: Actor;
    settings: OrganizationSettings;
    receipts: Record<string, { url: string; thumbUrl: string | null }>;
    canWork: (e: ExpenseView) => boolean;
  },
): ExpenseRow[] {
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    item: e.item,
    quantity: e.quantity,
    unitCostMinor: e.unitCostMinor,
    totalMinor: e.totalMinor,
    currency: e.currency,
    supplier: e.supplier,
    reason: e.reason,
    status: e.status,
    autoApproved: e.autoApproved,
    requester: e.requester?.name ?? null,
    decidedBy: e.decidedBy?.name ?? null,
    decisionComment: e.decisionComment,
    usedAt: e.usedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    age: formatRelative(e.createdAt),
    receiptUrl: opts.receipts[e.id]?.url ?? null,
    receiptThumbUrl: opts.receipts[e.id]?.thumbUrl ?? null,
    job: { id: e.job.id, number: formatJobNumber(e.job.number), title: e.job.title, status: e.job.status },
    canDecide: e.status === "pending" && expenses.canDecideExpense(opts.actor, e, opts.settings),
    canMarkUsed: e.kind === "part" && e.status === "approved" && !e.usedAt && opts.canWork(e),
  }));
}
