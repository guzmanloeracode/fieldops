"use server";
import { ai } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

export async function updateAiSettingsAction(input: unknown) {
  const result = await action(() => runService((ctx) => ai.updateAiSettings(ctx, input)));
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}
