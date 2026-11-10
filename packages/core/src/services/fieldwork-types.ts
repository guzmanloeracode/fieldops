import type { ChecklistItemKind, TimeEntryKind } from "@fieldops/shared";

// Records and repositories for 0.2 field work: checklists (JOB-08) and time entries (TEC-04).

/** A checklist answer: boolean (checkbox), number, text, or the id of a photo attachment. */
export type ChecklistValue = boolean | number | string | null;

export interface ChecklistItemRecord {
  id: string;
  jobId: string;
  position: number;
  label: string;
  kind: ChecklistItemKind;
  unit: string | null;
  required: boolean;
  value: ChecklistValue;
  doneBy: { id: string; name: string } | null;
  doneAt: Date | null;
}

export type NewChecklistItem = Pick<ChecklistItemRecord, "position" | "label" | "kind" | "unit" | "required">;

export interface ChecklistRepo {
  list(jobId: string): Promise<ChecklistItemRecord[]>;
  /** Replaces every item of the job (used when the checklist is generated from a template). */
  replace(jobId: string, items: NewChecklistItem[]): Promise<void>;
  setValue(
    jobId: string,
    itemId: string,
    data: { value: ChecklistValue; doneByUserId: string | null; doneAt: Date | null },
  ): Promise<void>;
}

export type TimeEntrySource = "status" | "manual";

export interface TimeEntryRecord {
  id: string;
  jobId: string;
  member: { id: string; name: string };
  kind: TimeEntryKind;
  startedAt: Date;
  /** Null while the clock is running. */
  endedAt: Date | null;
  source: TimeEntrySource;
  editedReason: string | null;
  editedBy: string | null;
  createdAt: Date;
}

export interface TimeEntryRepo {
  listByJob(jobId: string): Promise<TimeEntryRecord[]>;
  get(id: string): Promise<TimeEntryRecord | null>;
  create(data: {
    jobId: string;
    memberId: string;
    kind: TimeEntryKind;
    startedAt: Date;
    endedAt: Date | null;
    source: TimeEntrySource;
    editedReason?: string | null;
    editedBy?: string | null;
  }): Promise<TimeEntryRecord>;
  update(
    id: string,
    patch: {
      startedAt?: Date;
      endedAt?: Date | null;
      editedReason?: string | null;
      editedBy?: string | null;
    },
  ): Promise<TimeEntryRecord | null>;
  /** Stops every running entry of the job, or only the member's. Returns how many were stopped. */
  closeOpen(jobId: string, endedAt: Date, memberId?: string): Promise<number>;
}
