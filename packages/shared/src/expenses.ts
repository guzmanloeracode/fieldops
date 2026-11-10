import { z } from "zod";
import { EXPENSE_KINDS, EXPENSE_STATUSES } from "./constants";
import { csvEnum, optionalText, trimmed, ts } from "./fields";
import { currencySchema } from "./schemas";

// 0.2 parts and expenses: requests (EXP-01), decisions (EXP-02) and the approvals inbox (EXP-03).

export const expenseCreateSchema = z
  .object({
    kind: z.enum(EXPENSE_KINDS).default("part"),
    item: trimmed(200).min(1),
    quantity: z
      .number()
      .positive()
      .max(10_000)
      .refine((n) => Math.round(n * 100) === n * 100, "At most two decimals"),
    unit_cost_minor: z.number().int().min(0).max(100_000_000_00),
    supplier: optionalText(120),
    reason: trimmed(500).min(3),
    receipt_attachment_id: z.uuid().nullable().optional(),
  })
  .meta({ id: "ExpenseCreate" });
export type ExpenseCreate = z.output<typeof expenseCreateSchema>;

export const expenseDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    comment: optionalText(500),
  })
  .refine((v) => v.decision === "approve" || Boolean(v.comment), {
    message: "Say why the request is rejected",
    path: ["comment"],
  })
  .meta({ id: "ExpenseDecision" });
export type ExpenseDecision = z.output<typeof expenseDecisionSchema>;

export const expenseBulkDecisionSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100),
    decision: z.enum(["approve", "reject"]),
    comment: optionalText(500),
  })
  .refine((v) => v.decision === "approve" || Boolean(v.comment), {
    message: "Say why the requests are rejected",
    path: ["comment"],
  });
export type ExpenseBulkDecision = z.output<typeof expenseBulkDecisionSchema>;

export const expenseListQuerySchema = z.object({
  status: csvEnum(EXPENSE_STATUSES).optional(),
  kind: z.enum(EXPENSE_KINDS).optional(),
  technician: z.uuid().optional(),
  job: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type ExpenseListQuery = z.output<typeof expenseListQuerySchema>;

/** Approval thresholds in minor units of the organization's currency (EXP-02). */
export const approvalSettingsSchema = z
  .object({
    auto_approve_below_minor: z.number().int().min(0),
    dispatcher_limit_minor: z.number().int().min(0),
  })
  .refine((v) => v.dispatcher_limit_minor >= v.auto_approve_below_minor, {
    message: "The dispatcher limit can't be lower than the auto-approve threshold",
    path: ["dispatcher_limit_minor"],
  })
  .meta({ id: "ApprovalSettings" });
export type ApprovalSettings = z.output<typeof approvalSettingsSchema>;

export const expenseSchema = z
  .object({
    id: z.uuid(),
    job: z.object({ id: z.uuid(), number: z.string(), title: z.string() }),
    requester: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    kind: z.enum(EXPENSE_KINDS),
    item: z.string(),
    quantity: z.number(),
    unit_cost_minor: z.number().int(),
    total_minor: z.number().int(),
    currency: currencySchema,
    supplier: z.string().nullable(),
    reason: z.string(),
    receipt_attachment_id: z.uuid().nullable(),
    status: z.enum(EXPENSE_STATUSES),
    auto_approved: z.boolean(),
    decided_by: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    decided_at: ts.nullable(),
    decision_comment: z.string().nullable(),
    used_at: ts.nullable(),
    created_at: ts,
  })
  .meta({ id: "Expense" });
export type ExpenseDto = z.infer<typeof expenseSchema>;

/** The operations settings page: approval thresholds (EXP-02) and the signature rule (JOB-10). */
export const operationsSettingsSchema = z
  .object({
    auto_approve_below_minor: z.number().int().min(0).max(100_000_000_00),
    dispatcher_limit_minor: z.number().int().min(0).max(100_000_000_00),
    require_signature: z.boolean(),
  })
  .refine((v) => v.dispatcher_limit_minor >= v.auto_approve_below_minor, {
    message: "The dispatcher limit can't be lower than the auto-approve threshold",
    path: ["dispatcher_limit_minor"],
  })
  .meta({ id: "OperationsSettings" });
export type OperationsSettings = z.output<typeof operationsSettingsSchema>;

/** Result of a bulk decision: every request is checked on its own. */
export const expenseBulkResultSchema = z
  .object({
    results: z.array(
      z.object({
        id: z.uuid(),
        ok: z.boolean(),
        status: z.enum(EXPENSE_STATUSES).optional(),
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      }),
    ),
  })
  .meta({ id: "ExpenseBulkResult" });
