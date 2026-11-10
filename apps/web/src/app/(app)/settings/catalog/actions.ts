"use server";
import { catalog } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

const PATH = "/settings/catalog";

export async function createCatalogItemAction(input: unknown) {
  const r = await action(() =>
    runService((ctx) => catalog.createCatalogItem(ctx, input)).then((c) => ({ id: c.id })),
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function updateCatalogItemAction(id: string, input: unknown) {
  const r = await action(() =>
    runService((ctx) => catalog.updateCatalogItem(ctx, id, input)).then((c) => ({ id: c.id })),
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}
