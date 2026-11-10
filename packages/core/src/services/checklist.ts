import { checklistUpdateSchema, type ChecklistTemplateItem } from "@fieldops/shared";
import { ConflictError, ValidationError } from "../domain/errors";
import { assertCan } from "../domain/permissions";
import type { ChecklistItemRecord, ChecklistValue, NewChecklistItem } from "./fieldwork-types";
import { getJob, isAssigned, isClosed } from "./job-access";
import type { ServiceContext } from "./types";
import { parseInput } from "./validate";

// Checklists generated from service-type templates (JOB-08). Required items must be done before a job can be
// completed; the completion check lives in the job status machine (missingRequiredChecklistItems).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turns a service type's template into checklist items, in template order. */
export function itemsFromTemplate(template: readonly ChecklistTemplateItem[]): NewChecklistItem[] {
  return template.map((t, position) => ({
    position,
    label: t.label,
    kind: t.kind,
    unit: t.unit ?? null,
    required: t.required,
  }));
}

/** Creates the checklist of a new job from its service type's template. */
export async function generateForJob(ctx: ServiceContext, jobId: string, serviceTypeId: string | null) {
  const st = serviceTypeId ? await ctx.store.serviceTypes.get(serviceTypeId) : null;
  const items = itemsFromTemplate(st?.checklistTemplate ?? []);
  await ctx.store.checklist.replace(jobId, items);
  return items.length;
}

/**
 * After the service type changes: replace the checklist with the new template, unless work has started on it
 * (any item done), in which case the existing answers are kept.
 */
export async function regenerateIfUntouched(
  ctx: ServiceContext,
  jobId: string,
  serviceTypeId: string | null,
) {
  const current = await ctx.store.checklist.list(jobId);
  if (current.some((i) => i.doneAt)) return false;
  await generateForJob(ctx, jobId, serviceTypeId);
  return true;
}

export async function getChecklist(ctx: ServiceContext, jobId: string): Promise<ChecklistItemRecord[]> {
  const job = await getJob(ctx, jobId);
  return ctx.store.checklist.list(job.id);
}

/**
 * Checks an answer against the item kind. Returns the value to store and whether the item counts as done.
 * An item that isn't done always stores null.
 */
async function normalize(
  ctx: ServiceContext,
  jobId: string,
  item: ChecklistItemRecord,
  value: ChecklistValue,
  path: string,
): Promise<{ value: ChecklistValue; done: boolean }> {
  const invalid = (message: string) => new ValidationError(message, [{ path, message }]);
  if (value === null) return { value: null, done: false };
  switch (item.kind) {
    case "checkbox":
      if (typeof value !== "boolean") throw invalid(`“${item.label}” needs yes or no`);
      return value ? { value, done: true } : { value: null, done: false };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        throw invalid(`“${item.label}” needs a number`);
      return { value, done: true };
    case "text": {
      if (typeof value !== "string") throw invalid(`“${item.label}” needs text`);
      const text = value.trim();
      return text ? { value: text, done: true } : { value: null, done: false };
    }
    case "photo": {
      if (typeof value !== "string" || !UUID.test(value)) throw invalid(`“${item.label}” needs a photo`);
      const photo = await ctx.store.attachments.get(value);
      if (!photo || photo.jobId !== jobId || photo.kind !== "photo" || photo.status !== "ready") {
        throw invalid(`Choose a photo of this job for “${item.label}”`);
      }
      return { value, done: true };
    }
  }
}

/**
 * Saves answers. Allowed for the assigned technician and the office while the job is open. One timeline event
 * per save lists the items that changed.
 */
export async function updateChecklist(ctx: ServiceContext, jobId: string, raw: unknown) {
  const input = parseInput(checklistUpdateSchema, raw);
  const job = await getJob(ctx, jobId);
  assertCan(ctx.actor, "jobs.work", { assigned: isAssigned(ctx, job) });
  if (isClosed(job)) throw new ConflictError("The checklist of a completed or canceled job can't be changed");

  const items = await ctx.store.checklist.list(job.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const changed: { label: string; done: boolean }[] = [];
  for (const [index, entry] of input.items.entries()) {
    const item = byId.get(entry.id);
    if (!item) {
      throw new ValidationError("Unknown checklist item", [
        { path: `items.${index}.id`, message: "Not an item of this job" },
      ]);
    }
    const next = await normalize(ctx, job.id, item, entry.value, `items.${index}.value`);
    // Unchanged answers and clearing an item that was never done are not changes.
    if (next.value === item.value && next.done === Boolean(item.doneAt)) continue;
    if (!next.done && !item.doneAt) continue;
    await ctx.store.checklist.setValue(job.id, item.id, {
      value: next.value,
      doneByUserId: next.done ? ctx.actor.userId : null,
      doneAt: next.done ? ctx.now : null,
    });
    changed.push({ label: item.label, done: next.done });
  }
  if (changed.length) {
    await ctx.store.jobs.addEvent({
      jobId: job.id,
      type: "checklist_updated",
      fromStatus: null,
      toStatus: null,
      actorUserId: ctx.actor.userId,
      payload: {
        items: changed.map((c) => c.label),
        done: changed.filter((c) => c.done).length,
        cleared: changed.filter((c) => !c.done).length,
      },
    });
  }
  return ctx.store.checklist.list(job.id);
}

/** Progress for headers and badges. */
export function progress(items: readonly Pick<ChecklistItemRecord, "required" | "doneAt">[]) {
  return {
    total: items.length,
    done: items.filter((i) => i.doneAt).length,
    requiredLeft: items.filter((i) => i.required && !i.doneAt).length,
  };
}
