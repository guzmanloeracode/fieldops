import { sql } from "drizzle-orm";
import type { Database } from "./client";

// The queue of portal requests waiting for an AI draft (AI-01), worked by the worker as the table owner across
// organizations. Claiming moves a job from "pending" to "drafting" with FOR UPDATE SKIP LOCKED, like the email
// outbox, so two workers never draft the same request and no transaction stays open during the model call.

export async function claimPendingAiDrafts(
  db: Database,
  limit = 3,
): Promise<{ id: string; organizationId: string }[]> {
  const r = await db.execute<{ id: string; organization_id: string }>(sql`
    update job set ai_status = 'drafting', updated_at = now()
    where id in (
      select id from job where ai_status = 'pending' and deleted_at is null
      order by created_at limit ${limit} for update skip locked
    )
    returning id, organization_id`);
  return r.rows.map((row) => ({ id: row.id, organizationId: row.organization_id }));
}

/** Claims whose worker stopped mid-draft go back to the queue. */
export async function releaseStuckAiDrafts(db: Database, olderThanMinutes = 10): Promise<number> {
  const r = await db.execute(sql`
    update job set ai_status = 'pending'
    where ai_status = 'drafting' and updated_at < now() - make_interval(mins => ${olderThanMinutes})`);
  return r.rowCount ?? 0;
}

/** Marks a claimed request failed when drafting crashed outside the model call. */
export async function failAiDraft(db: Database, jobId: string): Promise<void> {
  await db.execute(sql`update job set ai_status = 'failed' where id = ${jobId} and ai_status = 'drafting'`);
}
