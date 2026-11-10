import type { ChecklistItemKind, TimeEntryKind } from "@fieldops/shared";
import type {
  ChecklistItemRecord,
  ChecklistRepo,
  ChecklistValue,
  TimeEntryRecord,
  TimeEntryRepo,
  TimeEntrySource,
} from "../services/fieldwork-types";
import type { MemberRecord } from "../services/types";

// In-memory checklist and time entry repositories for the memory store (0.2 field work).

/** A stored checklist item. Older tests only set jobId, label, required and done. */
export interface MemoryChecklistItem {
  jobId: string;
  label: string;
  required: boolean;
  done: boolean;
  id?: string;
  position?: number;
  kind?: ChecklistItemKind;
  unit?: string | null;
  value?: ChecklistValue;
  doneByUserId?: string | null;
  doneAt?: Date | null;
}

export interface MemoryTimeEntry {
  id: string;
  jobId: string;
  memberId: string;
  kind: TimeEntryKind;
  startedAt: Date;
  endedAt: Date | null;
  source: TimeEntrySource;
  editedReason: string | null;
  editedBy: string | null;
  createdAt: Date;
}

export interface FieldworkMemory {
  checklist: MemoryChecklistItem[];
  timeEntries: MemoryTimeEntry[];
  members: MemberRecord[];
}

export function fieldworkRepos(
  data: FieldworkMemory,
  uuid: () => string,
): { checklist: ChecklistRepo; timeEntries: TimeEntryRepo } {
  const userName = (userId: string | null | undefined) => data.members.find((m) => m.userId === userId)?.name;
  const toItem = (c: MemoryChecklistItem): ChecklistItemRecord => {
    c.id ??= uuid();
    const name = userName(c.doneByUserId);
    return {
      id: c.id,
      jobId: c.jobId,
      position: c.position ?? 0,
      label: c.label,
      kind: c.kind ?? "checkbox",
      unit: c.unit ?? null,
      required: c.required,
      value: c.value ?? null,
      doneBy: c.doneByUserId && name ? { id: c.doneByUserId, name } : null,
      doneAt: c.doneAt ?? (c.done ? new Date(0) : null),
    };
  };
  const toEntry = (e: MemoryTimeEntry): TimeEntryRecord => ({
    id: e.id,
    jobId: e.jobId,
    member: { id: e.memberId, name: data.members.find((m) => m.id === e.memberId)?.name ?? "" },
    kind: e.kind,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    source: e.source,
    editedReason: e.editedReason,
    editedBy: e.editedBy,
    createdAt: e.createdAt,
  });

  return {
    checklist: {
      async list(jobId) {
        return data.checklist
          .filter((c) => c.jobId === jobId)
          .map(toItem)
          .sort((a, b) => a.position - b.position);
      },
      async replace(jobId, items) {
        data.checklist = data.checklist
          .filter((c) => c.jobId !== jobId)
          .concat(items.map((i) => ({ ...i, jobId, id: uuid(), done: false, value: null })));
      },
      async setValue(jobId, itemId, v) {
        const c = data.checklist.find((x) => x.jobId === jobId && x.id === itemId);
        if (!c) return;
        c.value = v.value;
        c.doneByUserId = v.doneByUserId;
        c.doneAt = v.doneAt;
        c.done = v.doneAt !== null;
      },
    },
    timeEntries: {
      async listByJob(jobId) {
        return data.timeEntries
          .filter((e) => e.jobId === jobId)
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .map(toEntry);
      },
      async get(id) {
        const e = data.timeEntries.find((x) => x.id === id);
        return e ? toEntry(e) : null;
      },
      async create(input) {
        const e: MemoryTimeEntry = {
          editedReason: null,
          editedBy: null,
          ...input,
          id: uuid(),
          createdAt: new Date(),
        };
        data.timeEntries.push(e);
        return toEntry(e);
      },
      async update(id, patch) {
        const e = data.timeEntries.find((x) => x.id === id);
        if (!e) return null;
        Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
        return toEntry(e);
      },
      async closeOpen(jobId, endedAt, memberId) {
        const open = data.timeEntries.filter(
          (e) => e.jobId === jobId && e.endedAt === null && (!memberId || e.memberId === memberId),
        );
        for (const e of open) e.endedAt = endedAt;
        return open.length;
      },
    },
  };
}
