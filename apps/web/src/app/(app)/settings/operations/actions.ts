"use server";
import { organization } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

export async function updateOperationsSettingsAction(input: unknown) {
  const result = await action(() => runService((ctx) => organization.updateOperationsSettings(ctx, input)));
  if (result.ok) revalidatePath("/settings/operations");
  return result;
}
