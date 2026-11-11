"use server";
import { apiKeys } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

/** Creates a key for the signed-in member; the secret is returned once and never stored. */
export async function createApiKeyAction(input: unknown) {
  const result = await action(async () => {
    const { record, key } = await runService((ctx) => apiKeys.createApiKey(ctx, input));
    return { id: record.id, name: record.name, key };
  });
  if (result.ok) revalidatePath("/settings/api-keys");
  return result;
}

export async function revokeApiKeyAction(id: string) {
  const result = await action(async () => {
    await runService((ctx) => apiKeys.revokeApiKey(ctx, id));
    return null;
  });
  if (result.ok) revalidatePath("/settings/api-keys");
  return result;
}
