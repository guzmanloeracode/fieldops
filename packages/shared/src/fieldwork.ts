import { z } from "zod";
import { CHECKLIST_ITEM_KINDS, TIME_ENTRY_KINDS } from "./constants";
import { isoDateTime, trimmed, ts } from "./fields";

// 0.2 field work: checklists (JOB-08), time entries (TEC-04) and signatures (JOB-10).

/**
 * A checklist answer. checkbox → boolean; number → finite number; text → non-empty string;
 * photo → the id of a ready photo attachment of the same job. `null` clears the item.
 */
export const checklistValueSchema = z.union([z.boolean(), z.number().finite(), trimmed(2000), z.null()]);

export const checklistUpdateSchema = z
  .object({
    items: z
      .array(z.object({ id: z.uuid(), value: checklistValueSchema }))
      .min(1)
      .max(50),
  })
  .meta({ id: "ChecklistUpdate" });
export type ChecklistUpdate = z.output<typeof checklistUpdateSchema>;

export const checklistItemSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int(),
    label: z.string(),
    kind: z.enum(CHECKLIST_ITEM_KINDS),
    unit: z.string().nullable(),
    required: z.boolean(),
    value: checklistValueSchema,
    done: z.boolean(),
    done_by: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    done_at: ts.nullable(),
  })
  .meta({ id: "ChecklistItem" });
export type ChecklistItemDto = z.infer<typeof checklistItemSchema>;

/** Corrects a recorded time entry. The reason is kept and shown in the timeline. */
export const timeEntryUpdateSchema = z
  .object({
    started_at: isoDateTime,
    ended_at: isoDateTime.nullable(),
    reason: trimmed(300).min(3),
  })
  .refine((v) => !v.ended_at || v.ended_at > v.started_at, {
    message: "End must be after start",
    path: ["ended_at"],
  })
  .meta({ id: "TimeEntryUpdate" });
export type TimeEntryUpdate = z.output<typeof timeEntryUpdateSchema>;

/** Adds time that was not recorded by a status change. */
export const timeEntryCreateSchema = z
  .object({
    member_id: z.uuid().optional(),
    kind: z.enum(TIME_ENTRY_KINDS),
    started_at: isoDateTime,
    ended_at: isoDateTime,
    reason: trimmed(300).min(3),
  })
  .refine((v) => v.ended_at > v.started_at, { message: "End must be after start", path: ["ended_at"] })
  .meta({ id: "TimeEntryCreate" });
export type TimeEntryCreate = z.output<typeof timeEntryCreateSchema>;

export const timeEntrySchema = z
  .object({
    id: z.uuid(),
    job_id: z.uuid(),
    member: z.object({ id: z.uuid(), name: z.string() }),
    kind: z.enum(TIME_ENTRY_KINDS),
    started_at: ts,
    ended_at: ts.nullable(),
    minutes: z.number().int().nullable(),
    source: z.enum(["status", "manual"]),
    edited_reason: z.string().nullable(),
  })
  .meta({ id: "TimeEntry" });
export type TimeEntryDto = z.infer<typeof timeEntrySchema>;

/** Links an uploaded signature image to the job (JOB-10). */
export const signatureCaptureSchema = z
  .object({
    attachment_id: z.uuid(),
    signer_name: trimmed(120).min(1),
  })
  .meta({ id: "SignatureCapture" });
export type SignatureCapture = z.output<typeof signatureCaptureSchema>;

export const completionSettingsSchema = z
  .object({ require_signature: z.boolean() })
  .meta({ id: "CompletionSettings" });

export const timeTotalsSchema = z
  .object({
    member: z.object({ id: z.uuid(), name: z.string() }),
    travel_minutes: z.number().int(),
    work_minutes: z.number().int(),
    running: z.enum(TIME_ENTRY_KINDS).nullable().meta({ description: "The clock running now, if any" }),
  })
  .meta({ id: "TimeTotals" });

export const timeEntryListSchema = z
  .object({
    data: z.array(timeEntrySchema),
    totals: z.array(timeTotalsSchema),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: "TimeEntryList" });

export const checklistListSchema = z
  .object({
    data: z.array(checklistItemSchema),
    total: z.number().int(),
    done: z.number().int(),
    required_left: z.number().int(),
  })
  .meta({ id: "Checklist" });
