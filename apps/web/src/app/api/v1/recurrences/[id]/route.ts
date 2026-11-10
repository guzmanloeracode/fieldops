import { recurrences, type ServiceContext } from "@fieldops/core";
import { z } from "zod";
import { apiRoute } from "@/server/api/handler";
import { ApiProblem } from "@/server/api/problem";
import { toRecurrenceDto } from "@/server/api/serialize-recurrences";

type Params = { id: string };

function planId(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new ApiProblem(404, "not_found", "Maintenance plan not found");
  return id;
}

async function dto(ctx: ServiceContext, id: string) {
  const [described] = await recurrences.describePlans(ctx, [await recurrences.getPlan(ctx, id)]);
  return toRecurrenceDto(described!);
}

export const GET = apiRoute<Params>(async ({ params, ctx }) => ({ body: await dto(ctx, planId(params.id)) }));

export const PATCH = apiRoute<Params>(async ({ params, body, ctx }) => {
  const plan = await recurrences.updatePlan(ctx, planId(params.id), body ?? {});
  return { body: await dto(ctx, plan.id) };
});

export const DELETE = apiRoute<Params>(async ({ params, ctx }) => {
  await recurrences.deletePlan(ctx, planId(params.id));
  return { status: 204 };
});
