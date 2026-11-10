import { expenses } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toExpenseDto } from "@/server/api/serialize-expenses";

type Params = { id: string };

/** Parts and expenses requested on a job, newest first (EXP-01). */
export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  const rows = await expenses.listJobExpenses(ctx, params.id);
  return { body: { data: rows.map(toExpenseDto), next_cursor: null } };
});

export const POST = apiRoute<Params>(async ({ params, body, ctx }) => {
  const expense = await expenses.requestExpense(ctx, params.id, body);
  return {
    status: 201,
    body: toExpenseDto(expense),
    headers: { Location: `/api/v1/expenses/${expense.id}` },
  };
});
