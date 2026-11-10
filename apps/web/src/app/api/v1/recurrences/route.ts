import { recurrences } from "@fieldops/core";
import { apiRoute, queryObject } from "@/server/api/handler";
import { toRecurrenceDto } from "@/server/api/serialize-recurrences";

// Maintenance plans (JOB-13). Office roles only.

export const GET = apiRoute(async ({ url, ctx }) => {
  const page = await recurrences.listPlans(ctx, queryObject(url));
  const described = await recurrences.describePlans(ctx, page.rows);
  return { body: { data: described.map(toRecurrenceDto), next_cursor: page.nextCursor } };
});

export const POST = apiRoute(async ({ body, ctx }) => {
  const plan = await recurrences.createPlan(ctx, body);
  const [described] = await recurrences.describePlans(ctx, [plan]);
  return {
    status: 201,
    body: toRecurrenceDto(described!),
    headers: { Location: `/api/v1/recurrences/${plan.id}` },
  };
});
