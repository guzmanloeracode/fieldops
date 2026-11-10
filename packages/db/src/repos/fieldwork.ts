import type {
  ChecklistItemRecord,
  ChecklistRepo,
  ChecklistValue,
  TimeEntryRecord,
  TimeEntryRepo,
  TimeEntrySource,
} from "@fieldops/core";
import type { ChecklistItemKind, TimeEntryKind } from "@fieldops/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Tx } from "../client";
import { checklistItem, member, timeEntry, user } from "../schema";
import { definedOnly } from "./util";

// Checklists (JOB-08) and time entries (TEC-04). Every query is scoped by organization_id.

export function checklistRepo(tx: Tx, orgId: string): ChecklistRepo {
  return {
    async list(jobId) {
      const rows = await tx
        .select({ c: checklistItem, doneByName: user.name })
        .from(checklistItem)
        .leftJoin(user, eq(user.id, checklistItem.doneBy))
        .where(and(eq(checklistItem.organizationId, orgId), eq(checklistItem.jobId, jobId)))
        .orderBy(asc(checklistItem.position), asc(checklistItem.id));
      return rows.map(({ c, doneByName }): ChecklistItemRecord => ({
        id: c.id,
        jobId: c.jobId,
        position: c.position,
        label: c.label,
        kind: c.kind as ChecklistItemKind,
        unit: c.unit,
        required: c.required,
        value: (c.value as ChecklistValue | undefined) ?? null,
        doneBy: c.doneBy && doneByName ? { id: c.doneBy, name: doneByName } : null,
        doneAt: c.doneAt,
      }));
    },
    async replace(jobId, items) {
      await tx
        .delete(checklistItem)
        .where(and(eq(checklistItem.organizationId, orgId), eq(checklistItem.jobId, jobId)));
      if (!items.length) return;
      await tx.insert(checklistItem).values(
        items.map((i) => ({
          organizationId: orgId,
          jobId,
          position: i.position,
          label: i.label,
          kind: i.kind,
          unit: i.unit,
          required: i.required,
        })),
      );
    },
    async setValue(jobId, itemId, data) {
      await tx
        .update(checklistItem)
        .set({ value: data.value, doneBy: data.doneByUserId, doneAt: data.doneAt })
        .where(
          and(
            eq(checklistItem.organizationId, orgId),
            eq(checklistItem.jobId, jobId),
            eq(checklistItem.id, itemId),
          ),
        );
    },
  };
}

export function timeEntryRepo(tx: Tx, orgId: string): TimeEntryRepo {
  const scope = eq(timeEntry.organizationId, orgId);
  const select = () =>
    tx
      .select({ e: timeEntry, memberName: user.name })
      .from(timeEntry)
      .innerJoin(member, and(eq(member.id, timeEntry.memberId), eq(member.organizationId, orgId)))
      .innerJoin(user, eq(user.id, member.userId));
  const map = ({
    e,
    memberName,
  }: {
    e: typeof timeEntry.$inferSelect;
    memberName: string;
  }): TimeEntryRecord => ({
    id: e.id,
    jobId: e.jobId,
    member: { id: e.memberId, name: memberName },
    kind: e.kind as TimeEntryKind,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    source: e.source as TimeEntrySource,
    editedReason: e.editedReason,
    editedBy: e.editedBy,
    createdAt: e.createdAt,
  });
  const get = async (id: string) => {
    const [r] = await select().where(and(scope, eq(timeEntry.id, id)));
    return r ? map(r) : null;
  };
  return {
    async listByJob(jobId) {
      const rows = await select()
        .where(and(scope, eq(timeEntry.jobId, jobId)))
        .orderBy(asc(timeEntry.startedAt), asc(timeEntry.id));
      return rows.map(map);
    },
    get,
    async create(data) {
      const [r] = await tx
        .insert(timeEntry)
        .values({
          organizationId: orgId,
          jobId: data.jobId,
          memberId: data.memberId,
          kind: data.kind,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          source: data.source,
          editedReason: data.editedReason ?? null,
          editedBy: data.editedBy ?? null,
        })
        .returning({ id: timeEntry.id });
      return (await get(r!.id))!;
    },
    async update(id, patch) {
      const [r] = await tx
        .update(timeEntry)
        .set(definedOnly({ ...patch, updatedAt: new Date() }))
        .where(and(scope, eq(timeEntry.id, id)))
        .returning({ id: timeEntry.id });
      return r ? get(r.id) : null;
    },
    async closeOpen(jobId, endedAt, memberId) {
      const rows = await tx
        .update(timeEntry)
        .set({ endedAt, updatedAt: new Date() })
        .where(
          and(
            scope,
            eq(timeEntry.jobId, jobId),
            isNull(timeEntry.endedAt),
            memberId ? eq(timeEntry.memberId, memberId) : undefined,
          ),
        )
        .returning({ id: timeEntry.id });
      return rows.length;
    },
  };
}
