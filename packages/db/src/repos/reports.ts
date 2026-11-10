import type { ReportRepo, ServiceReportRecord } from "@fieldops/core";
import type { AiStatus, Locale, ReportStatus } from "@fieldops/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Database, Tx } from "../client";
import { serviceReport } from "../schema";

// Service reports (AI-03, FIN-04): one per job (a unique index), versioned for optimistic concurrency. The AI
// status changes without a version bump, and the audit trigger ignores it, so claiming isn't an edit.

function toRecord(r: typeof serviceReport.$inferSelect): ServiceReportRecord {
  return {
    id: r.id,
    jobId: r.jobId,
    status: r.status as ReportStatus,
    locale: r.locale as Locale,
    workPerformed: r.workPerformed,
    findings: r.findings,
    recommendations: r.recommendations,
    nextServiceDate: r.nextServiceDate,
    aiStatus: r.aiStatus as AiStatus | null,
    aiInteractionId: r.aiInteractionId,
    aiDrafted: r.aiDrafted,
    editedBy: r.editedBy,
    sentAt: r.sentAt,
    sentTo: r.sentTo,
    sentBy: r.sentBy,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function reportRepo(tx: Tx, orgId: string): ReportRepo {
  const scope = eq(serviceReport.organizationId, orgId);
  return {
    async get(id) {
      const [r] = await tx
        .select()
        .from(serviceReport)
        .where(and(scope, eq(serviceReport.id, id)));
      return r ? toRecord(r) : null;
    },

    async getByJob(jobId) {
      const [r] = await tx
        .select()
        .from(serviceReport)
        .where(and(scope, eq(serviceReport.jobId, jobId)));
      return r ? toRecord(r) : null;
    },

    async create(data) {
      const [r] = await tx
        .insert(serviceReport)
        .values({ organizationId: orgId, ...data })
        .onConflictDoNothing({ target: [serviceReport.organizationId, serviceReport.jobId] })
        .returning();
      return r ? toRecord(r) : null;
    },

    async update(id, patch, expectedVersion) {
      const [r] = await tx
        .update(serviceReport)
        .set({ ...patch, version: sql`${serviceReport.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            scope,
            eq(serviceReport.id, id),
            expectedVersion !== undefined ? eq(serviceReport.version, expectedVersion) : undefined,
          ),
        )
        .returning();
      return r ? toRecord(r) : null;
    },

    async setAiStatus(id, status, from) {
      const rows = await tx
        .update(serviceReport)
        // A claim stamps updated_at, so a crashed draft is released after a while (releaseStuckReports).
        .set(status === "drafting" ? { aiStatus: status, updatedAt: new Date() } : { aiStatus: status })
        .where(
          and(
            scope,
            eq(serviceReport.id, id),
            from !== undefined ? eq(serviceReport.aiStatus, from) : undefined,
          ),
        )
        .returning({ id: serviceReport.id });
      return rows.length > 0;
    },
  };
}

// ------------------------------------------------------------------ the worker's queue

/**
 * Reports waiting for an AI draft, across organizations (the worker runs as the table owner). Claiming moves them
 * from "pending" to "drafting" with FOR UPDATE SKIP LOCKED, so two workers never draft the same report, and the
 * claim commits before the model is called. `updated_at` marks the claim, for releasing stuck ones.
 */
export async function claimPendingReports(
  db: Database,
  limit = 3,
): Promise<{ id: string; jobId: string; organizationId: string }[]> {
  const r = await db.execute<{ id: string; job_id: string; organization_id: string }>(sql`
    update service_report set ai_status = 'drafting', updated_at = now()
    where id in (
      select id from service_report where ai_status = 'pending'
      order by created_at limit ${limit} for update skip locked
    )
    returning id, job_id, organization_id`);
  return r.rows.map((row) => ({ id: row.id, jobId: row.job_id, organizationId: row.organization_id }));
}

/** Claims whose worker stopped mid-draft go back to the queue. */
export async function releaseStuckReports(db: Database, olderThanMinutes = 10): Promise<number> {
  const r = await db.execute(sql`
    update service_report set ai_status = 'pending'
    where ai_status = 'drafting' and updated_at < now() - make_interval(mins => ${olderThanMinutes})`);
  return r.rowCount ?? 0;
}

/** Marks a claimed report failed when drafting crashed outside the model call; its prefilled text stays. */
export async function failReportDraft(db: Database, id: string): Promise<void> {
  await db.execute(
    sql`update service_report set ai_status = 'failed' where id = ${id} and ai_status = 'drafting'`,
  );
}
