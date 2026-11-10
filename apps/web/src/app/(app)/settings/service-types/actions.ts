"use server";
import { organization } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

const PATH = "/settings/service-types";

export async function createServiceTypeAction(input: unknown) {
  const result = await action(() =>
    runService((ctx) => organization.createServiceType(ctx, input)).then((s) => ({ id: s.id })),
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function updateServiceTypeAction(id: string, input: unknown) {
  const result = await action(() =>
    runService((ctx) => organization.updateServiceType(ctx, id, input)).then((s) => ({ id: s.id })),
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}
