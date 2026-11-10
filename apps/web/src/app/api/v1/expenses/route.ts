import { expenses, parseInput } from "@fieldops/core";
import { expenseListQuerySchema } from "@fieldops/shared";
import { apiRoute, queryObject } from "@/server/api/handler";
import { toExpenseDto } from "@/server/api/serialize-expenses";

/** The approvals inbox (EXP-03): filters and cursor pagination. */
export const GET = apiRoute(async ({ url, ctx }) => {
  const query = parseInput(expenseListQuerySchema, queryObject(url));
  const page = await expenses.listExpenses(ctx, { ...query, page: undefined });
  return { body: { data: page.rows.map(toExpenseDto), next_cursor: page.nextCursor } };
});
