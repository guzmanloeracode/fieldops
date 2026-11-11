import { sql } from "drizzle-orm";
import type { Database } from "./client";

// The integration-event outbox (PLT-03, §11.4, ADR 022), worked by the worker as the table owner across
// organizations. The 0005 triggers write rows in the transaction of the change; the worker claims due rows with
// FOR UPDATE SKIP LOCKED (status "sending" with a lease, so a worker that dies mid-batch only delays them), posts
// each to Relay with the row id as the Idempotency-Key, and marks it sent. Failures back off and give up after
// OUTBOX_MAX_ATTEMPTS.

export const OUTBOX_MAX_ATTEMPTS = 12;
/** How long a claimed row stays claimed before another worker may take it. */
export const OUTBOX_LEASE_SECONDS = 300;

/** Seconds before the next try after `attempts` failed ones: 30 s, 1 min, 2 min… capped at an hour (~6 h in all). */
export function outboxBackoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

export interface ClaimedOutboxEvent {
  id: string;
  organizationId: string;
  organizationName: string;
  type: string;
  payload: Record<string, unknown>;
  /** Including this one. */
  attempts: number;
}

export async function claimOutboxEvents(db: Database, limit = 50): Promise<ClaimedOutboxEvent[]> {
  const r = await db.execute<{
    id: string;
    organization_id: string;
    name: string;
    type: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(sql`
    with claimed as (
      update outbox_event set status = 'sending', attempts = attempts + 1,
        next_attempt_at = now() + make_interval(secs => ${OUTBOX_LEASE_SECONDS})
      where id in (
        select id from outbox_event
        where status in ('pending', 'sending') and next_attempt_at <= now()
        order by next_attempt_at, id
        limit ${limit}
        for update skip locked
      )
      returning id, organization_id, type, payload, attempts
    )
    select c.*, o.name from claimed c join organization o on o.id = c.organization_id
    order by c.id`);
  return r.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.name,
    type: row.type,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function markOutboxSent(db: Database, id: string, relayEventId: string): Promise<void> {
  await db.execute(sql`
    update outbox_event set status = 'sent', relay_event_id = ${relayEventId}, sent_at = now(), error = null
    where id = ${id}`);
}

/** Schedules the next try, or gives up once the row has used its attempts. */
export async function markOutboxFailed(
  db: Database,
  id: string,
  attempts: number,
  error: string,
): Promise<"retry" | "failed"> {
  const give = attempts >= OUTBOX_MAX_ATTEMPTS;
  await db.execute(sql`
    update outbox_event set
      status = ${give ? "failed" : "pending"},
      next_attempt_at = now() + make_interval(secs => ${outboxBackoffSeconds(attempts)}),
      error = ${error.slice(0, 500)}
    where id = ${id}`);
  return give ? "failed" : "retry";
}

/** Sent events are kept 7 days (as long as Relay keeps them), failed ones 30. */
export async function deleteOldOutboxEvents(db: Database): Promise<number> {
  const r = await db.execute(sql`
    delete from outbox_event
    where (status = 'sent' and sent_at < now() - interval '7 days')
       or (status = 'failed' and created_at < now() - interval '30 days')`);
  return r.rowCount ?? 0;
}

/** Organizations with webhooks on, e.g. to retire their Relay tenants before the demo reset. */
export async function organizationsWithWebhooks(db: Database): Promise<string[]> {
  const r = await db.execute<{ id: string }>(
    sql`select id from organization where webhooks_enabled_at is not null`,
  );
  return r.rows.map((row) => row.id);
}
