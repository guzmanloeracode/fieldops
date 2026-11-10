import { expenses } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toExpenseDto } from "@/server/api/serialize-expenses";

/** Approves or rejects a pending request (EXP-02). */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const expense = await expenses.decideExpense(ctx, params.id, body);
  return { body: toExpenseDto(expense) };
});
