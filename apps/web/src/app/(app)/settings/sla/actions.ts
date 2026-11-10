"use server";
import { sla } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

export async function updateSlaPoliciesAction(input: unknown) {
  const result = await action(() => runService((ctx) => sla.updatePolicies(ctx, input)));
  if (result.ok) revalidatePath("/settings/sla");
  return result;
}
