"use server";
import { recurrences } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

// Maintenance plans on the customer page (JOB-13). Creating or changing a plan creates its due jobs right away.

function refresh(customerId: string) {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/jobs");
}

export async function createPlanAction(customerId: string, input: unknown) {
  const result = await action(() =>
    runService(async (ctx) => {
      const plan = await recurrences.createPlan(ctx, input);
      return { id: plan.id, jobs: plan.jobCount };
    }),
  );
  if (result.ok) refresh(customerId);
  return result;
}

export async function updatePlanAction(customerId: string, id: string, input: unknown) {
  const result = await action(() =>
    runService(async (ctx) => {
      const plan = await recurrences.updatePlan(ctx, id, input);
      return { id: plan.id, jobs: plan.jobCount };
    }),
  );
  if (result.ok) refresh(customerId);
  return result;
}

export async function setPlanActiveAction(customerId: string, id: string, active: boolean) {
  const result = await action(() =>
    runService(async (ctx) => {
      const plan = active ? await recurrences.resumePlan(ctx, id) : await recurrences.pausePlan(ctx, id);
      return { id: plan.id, active: plan.active };
    }),
  );
  if (result.ok) refresh(customerId);
  return result;
}

export async function deletePlanAction(customerId: string, id: string) {
  const result = await action(() =>
    runService((ctx) => recurrences.deletePlan(ctx, id)).then(() => ({ id })),
  );
  if (result.ok) refresh(customerId);
  return result;
}
