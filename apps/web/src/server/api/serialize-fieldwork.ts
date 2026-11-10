import { checklists, timeEntries, type ChecklistItemRecord, type TimeEntryRecord } from "@fieldops/core";

type TimeTotals = timeEntries.TimeTotals;
import type { ChecklistItemDto, TimeEntryDto, checklistListSchema, timeTotalsSchema } from "@fieldops/shared";
import type { z } from "zod";

// Field work DTOs (JOB-08, TEC-04): records to the snake_case API representation.

export function toChecklistItemDto(i: ChecklistItemRecord): ChecklistItemDto {
  return {
    id: i.id,
    position: i.position,
    label: i.label,
    kind: i.kind,
    unit: i.unit,
    required: i.required,
    value: i.value,
    done: i.doneAt !== null,
    done_by: i.doneBy,
    done_at: i.doneAt?.toISOString() ?? null,
  };
}

export function toChecklistDto(items: ChecklistItemRecord[]): z.infer<typeof checklistListSchema> {
  const p = checklists.progress(items);
  return { data: items.map(toChecklistItemDto), total: p.total, done: p.done, required_left: p.requiredLeft };
}

export function toTimeEntryDto(e: TimeEntryRecord, now = new Date()): TimeEntryDto {
  return {
    id: e.id,
    job_id: e.jobId,
    member: e.member,
    kind: e.kind,
    started_at: e.startedAt.toISOString(),
    ended_at: e.endedAt?.toISOString() ?? null,
    minutes: e.endedAt ? timeEntries.entryMinutes(e, now) : null,
    source: e.source,
    edited_reason: e.editedReason,
  };
}

export function toTimeTotalsDto(t: TimeTotals): z.infer<typeof timeTotalsSchema> {
  return {
    member: t.member,
    travel_minutes: t.travelMin,
    work_minutes: t.workMin,
    running: t.running,
  };
}
