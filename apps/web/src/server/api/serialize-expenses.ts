import { formatJobNumber, type ExpenseView } from "@fieldops/core";
import type { ExpenseDto } from "@fieldops/shared";

/** Maps an expense to its public snake_case representation (EXP-01–03). */
export function toExpenseDto(e: ExpenseView): ExpenseDto {
  return {
    id: e.id,
    job: { id: e.job.id, number: formatJobNumber(e.job.number), title: e.job.title },
    requester: e.requester,
    kind: e.kind,
    item: e.item,
    quantity: e.quantity,
    unit_cost_minor: e.unitCostMinor,
    total_minor: e.totalMinor,
    currency: e.currency,
    supplier: e.supplier,
    reason: e.reason,
    receipt_attachment_id: e.receiptAttachmentId,
    status: e.status,
    auto_approved: e.autoApproved,
    decided_by: e.decidedBy,
    decided_at: e.decidedAt?.toISOString() ?? null,
    decision_comment: e.decisionComment,
    used_at: e.usedAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
  };
}
