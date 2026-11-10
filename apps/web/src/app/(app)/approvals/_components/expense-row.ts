import type { Currency, ExpenseKind, ExpenseStatus, JobStatus } from "@fieldops/shared";

/** One request as the job page and the approvals inbox render it (dates as strings, names resolved). */
export interface ExpenseRow {
  id: string;
  kind: ExpenseKind;
  item: string;
  quantity: number;
  unitCostMinor: number;
  totalMinor: number;
  currency: Currency;
  supplier: string | null;
  reason: string;
  status: ExpenseStatus;
  autoApproved: boolean;
  requester: string | null;
  decidedBy: string | null;
  decisionComment: string | null;
  usedAt: string | null;
  createdAt: string;
  /** "3 hours ago", computed on the server so the client renders the same text. */
  age: string;
  receiptUrl: string | null;
  receiptThumbUrl: string | null;
  job: { id: string; number: string; title: string; status: JobStatus };
  /** The viewer may approve or reject it (pending and within their limit). */
  canDecide: boolean;
  /** The viewer may record it as used (approved part, not used yet, on a job they work on). */
  canMarkUsed: boolean;
}
