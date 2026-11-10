"use server";
import { organization } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

export async function updateOrganizationAction(input: unknown) {
  const result = await action(() => runService((ctx) => organization.updateOrganization(ctx, input)).then((o) => ({ id: o.id })));
  // The organization name also appears in the app shell, so refresh every page.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
