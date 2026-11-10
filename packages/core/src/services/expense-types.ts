import type { Currency, ExpenseKind, ExpenseListQuery, ExpenseStatus, JobStatus } from "@fieldops/shared";

// Parts and expenses (EXP-01 to EXP-03). Kept apart from types.ts so the 0.2 slices merge cleanly.

export interface ExpenseRecord {
  id: string;
  jobId: string;
  requesterMemberId: string | null;
  kind: ExpenseKind;
  item: string;
  quantity: number;
  unitCostMinor: number;
  totalMinor: number;
  currency: Currency;
  supplier: string | null;
  reason: string;
  receiptAttachmentId: string | null;
  status: ExpenseStatus;
  autoApproved: boolean;
  decidedByMemberId: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  /** When the technician recorded the part as used (TEC-03). */
  usedAt: Date | null;
  billable: boolean;
  markupBps: number;
  createdAt: Date;
  updatedAt: Date;
}

/** An expense with the names the inbox and job page show. */
export interface ExpenseView extends ExpenseRecord {
  job: { id: string; number: number; title: string; status: JobStatus };
  requester: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
}

export interface ExpenseListFilters extends ExpenseListQuery {
  /** Restricts results to jobs assigned to this member (technicians, TEC-05). */
  assignedMemberId?: string;
}

export type NewExpense = Omit<
  ExpenseRecord,
  "id" | "createdAt" | "updatedAt" | "usedAt" | "billable" | "markupBps"
>;

export interface ExpenseRepo {
  /** Newest first. Offset pages when `page` is set (UI), keyset cursors otherwise (API). */
  list(
    filters: ExpenseListFilters,
  ): Promise<{ rows: ExpenseView[]; nextCursor: string | null; total: number | null }>;
  listByJob(jobId: string): Promise<ExpenseView[]>;
  get(id: string): Promise<ExpenseView | null>;
  create(data: NewExpense): Promise<ExpenseRecord>;
  /** Records the decision only while the request is still pending; null when it was decided meanwhile. */
  decide(
    id: string,
    decision: {
      status: "approved" | "rejected";
      decidedByMemberId: string;
      decidedAt: Date;
      comment: string | null;
    },
  ): Promise<ExpenseRecord | null>;
  markUsed(id: string, at: Date): Promise<ExpenseRecord | null>;
  /** Pending requests on live jobs (approvals badge, dispatcher home). */
  countPending(): Promise<number>;
}
