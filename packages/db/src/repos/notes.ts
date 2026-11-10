import type { AttachmentRecord, AttachmentRepo, NoteRepo } from "@fieldops/core";
import type { AttachmentKind, AttachmentTag, NoteVisibility } from "@fieldops/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Tx } from "../client";
import { attachment, note, user } from "../schema";

export function noteRepo(tx: Tx, orgId: string): NoteRepo {
  return {
    async list(jobId, opts) {
      const rows = await tx
        .select({ n: note, authorName: user.name })
        .from(note)
        .leftJoin(user, eq(user.id, note.authorUserId))
        .where(
          and(
            eq(note.organizationId, orgId),
            eq(note.jobId, jobId),
            opts?.visibility ? eq(note.visibility, opts.visibility) : undefined,
          ),
        )
        .orderBy(desc(note.createdAt));
      return rows.map(({ n, authorName }) => ({
        id: n.id,
        jobId: n.jobId,
        body: n.body,
        visibility: n.visibility as NoteVisibility,
        author: n.authorUserId && authorName ? { id: n.authorUserId, name: authorName } : null,
        createdAt: n.createdAt,
      }));
    },
    async create(jobId, data) {
      const [n] = await tx
        .insert(note)
        .values({ organizationId: orgId, jobId, body: data.body, visibility: data.visibility, authorUserId: data.authorUserId })
        .returning();
      const [u] = await tx.select({ name: user.name }).from(user).where(eq(user.id, data.authorUserId));
      return {
        id: n!.id,
        jobId,
        body: n!.body,
        visibility: n!.visibility as NoteVisibility,
        author: u ? { id: data.authorUserId, name: u.name } : null,
        createdAt: n!.createdAt,
      };
    },
  };
}

function toAttachment(r: typeof attachment.$inferSelect): AttachmentRecord {
  return {
    id: r.id,
    jobId: r.jobId,
    kind: r.kind as AttachmentKind,
    storageKey: r.storageKey,
    thumbKey: r.thumbKey,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    tag: (r.tag as AttachmentTag | null) ?? null,
    status: r.status as "pending" | "ready",
    uploadedBy: r.uploadedBy,
    createdAt: r.createdAt,
  };
}

export function attachmentRepo(tx: Tx, orgId: string): AttachmentRepo {
  const scope = eq(attachment.organizationId, orgId);
  return {
    async list(jobId) {
      const rows = await tx
        .select()
        .from(attachment)
        .where(and(scope, eq(attachment.jobId, jobId)))
        .orderBy(asc(attachment.createdAt));
      return rows.map(toAttachment);
    },
    async get(id) {
      const [r] = await tx.select().from(attachment).where(and(scope, eq(attachment.id, id)));
      return r ? toAttachment(r) : null;
    },
    async create(data) {
      const [r] = await tx
        .insert(attachment)
        .values({ organizationId: orgId, ...data })
        .returning();
      return toAttachment(r!);
    },
    async markReady(id) {
      const [r] = await tx
        .update(attachment)
        .set({ status: "ready" })
        .where(and(scope, eq(attachment.id, id)))
        .returning();
      return r ? toAttachment(r) : null;
    },
    async remove(id) {
      const r = await tx.delete(attachment).where(and(scope, eq(attachment.id, id))).returning({ id: attachment.id });
      return r.length > 0;
    },
  };
}
