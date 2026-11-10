"use server";
import { catalog } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

export async function updateBillingSettingsAction(input: unknown) {
  const r = await action(() =>
    runService((ctx) => catalog.updateBillingSettings(ctx, input)).then(() => ({})),
  );
  if (r.ok) revalidatePath("/settings/billing");
  return r;
}
