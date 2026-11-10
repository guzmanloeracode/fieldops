import { expenses } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toExpenseDto } from "@/server/api/serialize-expenses";

/** Records an approved part as used on the job (TEC-03). */
export const POST = apiRoute<{ id: string }>(async ({ params, ctx }) => {
  const expense = await expenses.markExpenseUsed(ctx, params.id);
  return { body: toExpenseDto(expense) };
});
