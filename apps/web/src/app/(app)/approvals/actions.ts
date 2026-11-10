"use server";
import { expenses } from "@fieldops/core";
import type { ExpenseDecision } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

// Server actions for parts and expenses (EXP-01–03). Every rule lives in the core service.

function refresh() {
  revalidatePath("/jobs/[number]", "page");
  revalidatePath("/approvals");
  // The pending count shows in the navigation on every page.
  revalidatePath("/", "layout");
}

export async function requestExpenseAction(jobId: string, input: unknown) {
  const result = await action(() =>
    runService(async (ctx) => {
      const e = await expenses.requestExpense(ctx, jobId, input);
      return { id: e.id, status: e.status, autoApproved: e.autoApproved };
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function decideExpenseAction(id: string, input: ExpenseDecision) {
  const result = await action(() =>
    runService(async (ctx) => {
      const e = await expenses.decideExpense(ctx, id, input);
      return { id: e.id, status: e.status };
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function decideExpensesAction(input: unknown) {
  const result = await action(() => runService((ctx) => expenses.decideExpenses(ctx, input)));
  if (result.ok && result.data.some((r) => r.ok)) refresh();
  return result;
}

export async function markExpenseUsedAction(id: string) {
  const result = await action(() =>
    runService(async (ctx) => {
      const e = await expenses.markExpenseUsed(ctx, id);
      return { id: e.id, usedAt: e.usedAt?.toISOString() ?? null };
    }),
  );
  if (result.ok) refresh();
  return result;
}
