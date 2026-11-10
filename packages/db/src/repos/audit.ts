import type { AuditEntryRecord, AuditRepo } from "@fieldops/core";
import { and, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { auditLog, job, user } from "../schema";

// Audit log (AUD-01–03). Row changes are logged by the audit_row() trigger (ADR 016). The runtime role can't
// insert into audit_log directly, so events that aren't row changes go through audit_event(), which takes the
// organization, actor, IP address and user agent from the transaction settings. The viewer reads with keyset
// pagination on (created_at, id), newest first.

const UUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
/** Tables whose rows belong to a job: updates log only changed columns, so their job_id is looked up. */
const JOB_CHILDREN = [
  "job_assignment",
  "checklist_item",
  "note",
  "attachment",
  "time_entry",
  "expense_request",
];
const entityUuid = `(case when "audit_log"."entity_id" ~ '${UUID}' then "audit_log"."entity_id"::uuid end)`;

/** The job an entry belongs to: the job itself, or the job of a job's child row (assignment, note, …). */
const jobRef = `coalesce(
  "audit_log"."after" ->> 'job_id',
  "audit_log"."before" ->> 'job_id',
  case "audit_log"."entity_type"
    when 'job' then "audit_log"."entity_id"
    ${JOB_CHILDREN.map((t) => `when '${t}' then (select c.job_id::text from "${t}" c where c.id = ${entityUuid})`).join("\n    ")}
  end)`;
const jobUuid = sql.raw(`(case when ${jobRef} ~ '${UUID}' then (${jobRef})::uuid end)`);

export function auditRepo(tx: Tx, orgId: string): AuditRepo {
  return {
    async record(entry) {
      await tx.execute(
        sql`select audit_event(${entry.action}, ${entry.entityType}, ${entry.entityId}, ${
          entry.after ? JSON.stringify(entry.after) : null
        }::jsonb)`,
      );
    },

    async list(f) {
      const where: (SQL | undefined)[] = [eq(auditLog.organizationId, orgId)];
      if (f.actor === "system") where.push(isNull(auditLog.actorUserId));
      else if (f.actor) where.push(eq(auditLog.actorUserId, f.actor));
      if (f.entityType) where.push(eq(auditLog.entityType, f.entityType));
      if (f.operation) {
        where.push(sql`right(${auditLog.action}, ${f.operation.length + 1}) = ${`.${f.operation}`}`);
      }
      if (f.entityId) where.push(eq(auditLog.entityId, f.entityId));
      if (f.from) where.push(gte(auditLog.createdAt, f.from));
      if (f.to) where.push(lt(auditLog.createdAt, f.to));
      if (f.before) {
        where.push(
          sql`(${auditLog.createdAt}, ${auditLog.id}) < (${f.before.createdAt.toISOString()}::timestamptz, ${f.before.id}::uuid)`,
        );
      }
      const rows = await tx
        .select({ a: auditLog, actorName: user.name, jobId: job.id, jobNumber: job.number })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.actorUserId))
        .leftJoin(job, and(eq(job.organizationId, auditLog.organizationId), sql`${job.id} = ${jobUuid}`))
        .where(and(...where))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(f.limit);
      return rows.map(({ a, actorName, jobId, jobNumber }): AuditEntryRecord => ({
        id: a.id,
        createdAt: a.createdAt,
        actorUserId: a.actorUserId,
        actorName: actorName ?? null,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        before: (a.before as Record<string, unknown> | null) ?? null,
        after: (a.after as Record<string, unknown> | null) ?? null,
        ip: a.ip,
        userAgent: a.userAgent,
        job: jobId && jobNumber !== null ? { id: jobId, number: jobNumber } : null,
      }));
    },

    async actors() {
      const rows = await tx
        .selectDistinct({ userId: user.id, name: user.name })
        .from(auditLog)
        .innerJoin(user, eq(user.id, auditLog.actorUserId))
        .where(and(eq(auditLog.organizationId, orgId), isNotNull(auditLog.actorUserId)))
        .orderBy(user.name);
      return rows;
    },
  };
}
