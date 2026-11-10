"use server";
import { checklists, signatures, timeEntries } from "@fieldops/core";
import type { ChecklistUpdate, SignatureCapture, TimeEntryCreate, TimeEntryUpdate } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

// Server actions for field work on the job page: checklist (JOB-08), time (TEC-04) and signature (JOB-10).

const refresh = () => revalidatePath("/jobs/[number]", "page");

export async function updateChecklistAction(jobId: string, input: ChecklistUpdate) {
  const result = await action(() =>
    runService(async (ctx) => checklists.progress(await checklists.updateChecklist(ctx, jobId, input))),
  );
  if (result.ok) refresh();
  return result;
}

export async function updateTimeEntryAction(entryId: string, input: TimeEntryUpdate) {
  const result = await action(() => runService((ctx) => timeEntries.updateTimeEntry(ctx, entryId, input)));
  if (result.ok) refresh();
  return result.ok ? { ok: true as const, data: null } : result;
}

export async function addTimeEntryAction(jobId: string, input: TimeEntryCreate) {
  const result = await action(() => runService((ctx) => timeEntries.addTimeEntry(ctx, jobId, input)));
  if (result.ok) refresh();
  return result.ok ? { ok: true as const, data: null } : result;
}

export async function captureSignatureAction(jobId: string, input: SignatureCapture) {
  const result = await action(() => runService((ctx) => signatures.captureSignature(ctx, jobId, input)));
  if (result.ok) refresh();
  return result.ok ? { ok: true as const, data: { id: result.data.id } } : result;
}
