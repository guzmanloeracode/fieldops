"use server";
import { bulk, views } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, requireActor, runService } from "@/server/context";

// Saved views and bulk actions for the jobs table (JOB-04).

export async function createViewAction(input: { name: string; query: string; shared: boolean }) {
  const result = await action(() =>
    runService((ctx) => views.createView(ctx, input)).then((v) => ({ id: v.id })),
  );
  if (result.ok) revalidatePath("/jobs");
  return result;
}

export async function deleteViewAction(id: string) {
  const result = await action(() => runService((ctx) => views.deleteView(ctx, id)).then(() => ({ id })));
  if (result.ok) revalidatePath("/jobs");
  return result;
}

/** Applies one action to many jobs; each job runs in its own transaction. */
export async function bulkJobsAction(input: unknown) {
  const actor = await requireActor();
  const result = await action(() => bulk.runBulkJobAction(actor, input, (fn) => runService(fn, actor)));
  if (result.ok && result.data.updated > 0) revalidatePath("/jobs");
  return result;
}
