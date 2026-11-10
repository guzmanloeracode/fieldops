import {
  expenseBulkDecisionSchema,
  expenseCreateSchema,
  expenseDecisionSchema,
  type Currency,
  type ExpenseListQuery,
} from "@fieldops/shared";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { isOpen } from "../domain/job-status";
import { money, multiplyMoney } from "../domain/money";
import { assertCan, can, seesOnlyAssigned, type Actor } from "../domain/permissions";
import type { ExpenseView } from "./expense-types";
import { getJob } from "./jobs";
import * as notifications from "./notifications";
import { parseInput } from "./validate";
import type { JobView, OrganizationSettings, ServiceContext } from "./types";

// Parts and expenses: a technician asks, an approver decides, the part is recorded as used (EXP-01–03).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isAssigned = (ctx: ServiceContext, job: Pick<JobView, "assignees">) =>
  job.assignees.some((a) => a.memberId === ctx.actor.memberId);

/** Total cost of a request: quantity × unit cost, rounded half away from zero to a whole minor unit. */
export function expenseTotal(quantity: number, unitCostMinor: number, currency: Currency): number {
  return multiplyMoney(money(unitCostMinor, currency), quantity).amountMinor;
}

/**
 * Whether the actor may approve or reject this request. Owners and admins approve any amount; dispatchers
 * only below the organization's dispatcher limit (EXP-02).
 */
export function canDecideExpense(
  actor: Pick<Actor, "role">,
  expense: { totalMinor: number },
  settings: OrganizationSettings,
): boolean {
  return can(actor, "expenses.approve", {
    belowDispatcherThreshold: expense.totalMinor < settings.approval.dispatcherLimitMinor,
  });
}

/** Approved and pending totals for a list of requests (rejected ones don't count). */
export function summarizeExpenses(rows: Pick<ExpenseView, "status" | "totalMinor">[]) {
  return rows.reduce(
    (acc, r) => {
      if (r.status === "approved") acc.approvedMinor += r.totalMinor;
      if (r.status === "pending") {
        acc.pendingMinor += r.totalMinor;
        acc.pendingCount += 1;
      }
      return acc;
    },
    { approvedMinor: 0, pendingMinor: 0, pendingCount: 0 },
  );
}

/** The approvals inbox and `GET /expenses`. Technicians only see requests on jobs assigned to them. */
export async function listExpenses(ctx: ServiceContext, query: ExpenseListQuery) {
  assertCan(ctx.actor, "expenses.view", { assigned: true });
  return ctx.store.expenses.list({
    ...query,
    ...(seesOnlyAssigned(ctx.actor) ? { assignedMemberId: ctx.actor.memberId } : {}),
  });
}

export async function listJobExpenses(ctx: ServiceContext, jobId: string) {
  const job = await getJob(ctx, jobId);
  assertCan(ctx.actor, "expenses.view", { assigned: isAssigned(ctx, job) });
  return ctx.store.expenses.listByJob(job.id);
}

/** Loads a request the actor may see; requests on another technician's jobs are reported as not found. */
export async function getExpense(ctx: ServiceContext, id: string): Promise<ExpenseView> {
  const expense = UUID.test(id) ? await ctx.store.expenses.get(id) : null;
  if (!expense) throw new NotFoundError("Expense");
  const job = await getJob(ctx, expense.jobId);
  assertCan(ctx.actor, "expenses.view", { assigned: isAssigned(ctx, job) });
  return expense;
}

/**
 * EXP-01: requests a part or expense on an open job. Requests under the auto-approve threshold are approved
 * on the spot; the rest wait for an approver.
 */
export async function requestExpense(ctx: ServiceContext, jobId: string, raw: unknown): Promise<ExpenseView> {
  const input = parseInput(expenseCreateSchema, raw);
  const job = await getJob(ctx, jobId);
  assertCan(ctx.actor, "expenses.request", { assigned: isAssigned(ctx, job) });
  if (!isOpen(job.status)) throw new ConflictError("Parts and expenses can only be requested on open jobs");

  if (input.receipt_attachment_id) {
    const receipt = await ctx.store.attachments.get(input.receipt_attachment_id);
    if (!receipt || receipt.jobId !== job.id || receipt.status !== "ready") {
      throw new ValidationError("The receipt isn't an uploaded file of this job", [
        { path: "receipt_attachment_id", message: "Upload the receipt to this job first" },
      ]);
    }
  }

  const org = await ctx.store.organization.get();
  const totalMinor = expenseTotal(input.quantity, input.unit_cost_minor, org.currency);
  const auto = totalMinor < org.settings.approval.autoApproveBelowMinor;
  const created = await ctx.store.expenses.create({
    jobId: job.id,
    requesterMemberId: ctx.actor.memberId,
    kind: input.kind,
    item: input.item,
    quantity: input.quantity,
    unitCostMinor: input.unit_cost_minor,
    totalMinor,
    currency: org.currency,
    supplier: input.supplier ?? null,
    reason: input.reason,
    receiptAttachmentId: input.receipt_attachment_id ?? null,
    status: auto ? "approved" : "pending",
    autoApproved: auto,
    decidedByMemberId: null,
    decidedAt: auto ? ctx.now : null,
    decisionComment: null,
  });
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "expense_requested",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: {
      expense_id: created.id,
      kind: created.kind,
      item: created.item,
      quantity: created.quantity,
      total_minor: created.totalMinor,
      currency: created.currency,
      auto_approved: auto,
    },
  });
  const view = (await ctx.store.expenses.get(created.id))!;
  await notifications.afterExpenseRequested(ctx, view);
  return view;
}

/** EXP-02: approves or rejects a pending request. Rejections need a comment. */
export async function decideExpense(ctx: ServiceContext, id: string, raw: unknown): Promise<ExpenseView> {
  const input = parseInput(expenseDecisionSchema, raw);
  const expense = await getExpense(ctx, id);
  const org = await ctx.store.organization.get();
  if (!canDecideExpense(ctx.actor, expense, org.settings)) {
    throw new ForbiddenError(
      can(ctx.actor, "expenses.approve", { belowDispatcherThreshold: true })
        ? "This amount is above your approval limit"
        : "You don't have permission to approve parts and expenses",
    );
  }
  if (expense.status !== "pending") throw new ConflictError("This request has already been decided");
  const status = input.decision === "approve" ? "approved" : "rejected";
  const decided = await ctx.store.expenses.decide(expense.id, {
    status,
    decidedByMemberId: ctx.actor.memberId,
    decidedAt: ctx.now,
    comment: input.comment ?? null,
  });
  if (!decided) throw new ConflictError("This request has already been decided");
  await ctx.store.jobs.addEvent({
    jobId: expense.jobId,
    type: "expense_decided",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: {
      expense_id: expense.id,
      item: expense.item,
      decision: status,
      total_minor: expense.totalMinor,
      currency: expense.currency,
      ...(input.comment ? { comment: input.comment } : {}),
    },
  });
  const view = (await ctx.store.expenses.get(expense.id))!;
  await notifications.afterExpenseDecided(ctx, view);
  return view;
}

export type BulkDecisionResult =
  | { id: string; ok: true; status: "approved" | "rejected" }
  | { id: string; ok: false; error: { code: string; message: string } };

/**
 * EXP-03: decides many requests at once. Each one is checked on its own (a dispatcher's requests above their
 * limit fail without stopping the rest), and the result lists every request.
 */
export async function decideExpenses(ctx: ServiceContext, raw: unknown): Promise<BulkDecisionResult[]> {
  const input = parseInput(expenseBulkDecisionSchema, raw);
  assertCan(ctx.actor, "expenses.approve", { belowDispatcherThreshold: true });
  const results: BulkDecisionResult[] = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      const e = await decideExpense(ctx, id, { decision: input.decision, comment: input.comment });
      results.push({ id, ok: true, status: e.status as "approved" | "rejected" });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      results.push({ id, ok: false, error: { code: err.code, message: err.message } });
    }
  }
  return results;
}

/** TEC-03: records an approved part as used on the job. Repeating it keeps the first time. */
export async function markExpenseUsed(ctx: ServiceContext, id: string): Promise<ExpenseView> {
  const expense = await getExpense(ctx, id);
  const job = await getJob(ctx, expense.jobId);
  assertCan(ctx.actor, "jobs.work", { assigned: isAssigned(ctx, job) });
  if (expense.kind !== "part" || expense.status !== "approved") {
    throw new ConflictError("Only approved parts can be recorded as used");
  }
  if (expense.usedAt) return expense;
  await ctx.store.expenses.markUsed(expense.id, ctx.now);
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "part_used",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: { expense_id: expense.id, item: expense.item, quantity: expense.quantity },
  });
  return (await ctx.store.expenses.get(expense.id))!;
}

/** Pending requests for the approvals badge. Zero for people who can't approve anything. */
export async function countPendingExpenses(ctx: ServiceContext): Promise<number> {
  if (!can(ctx.actor, "expenses.approve", { belowDispatcherThreshold: true })) return 0;
  return ctx.store.expenses.countPending();
}

/** Signed links to the receipts of requests the caller already loaded (and may see). */
export async function receiptLinks(
  ctx: ServiceContext,
  rows: Pick<ExpenseView, "id" | "receiptAttachmentId">[],
): Promise<Record<string, { url: string; thumbUrl: string | null }>> {
  const out: Record<string, { url: string; thumbUrl: string | null }> = {};
  if (!ctx.files) return out;
  for (const r of rows) {
    if (!r.receiptAttachmentId) continue;
    const a = await ctx.store.attachments.get(r.receiptAttachmentId);
    if (a?.status !== "ready") continue;
    out[r.id] = {
      url: await ctx.files.presignGet(a.storageKey, { downloadName: a.fileName }),
      thumbUrl: a.thumbKey ? await ctx.files.presignGet(a.thumbKey) : null,
    };
  }
  return out;
}
