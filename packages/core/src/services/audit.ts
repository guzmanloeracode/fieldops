import { auditListQuerySchema } from "@fieldops/shared";
import { shiftDate, zonedInstant } from "../domain/availability";
import { decodeCursor, encodeCursor } from "../domain/cursor";
import { assertCan } from "../domain/permissions";
import type { AuditEntryRecord } from "./audit-types";
import { parseInput } from "./validate";
import type { ServiceContext, Store } from "./types";

// Audit log viewer (AUD-03) and the audit events that aren't row changes (AUD-01 sign-ins). The rows
// themselves are written by the database (ADR 016), in the transaction of the change.

const CURSOR_SORT = "-created_at";

export interface AuditPage {
  rows: AuditEntryRecord[];
  nextCursor: string | null;
}

/** Newest first, filtered, with a keyset cursor. Owners and admins only. */
export async function listAuditLog(ctx: ServiceContext, raw: unknown): Promise<AuditPage> {
  assertCan(ctx.actor, "audit.view");
  const q = parseInput(auditListQuerySchema, raw);
  const org = await ctx.store.organization.get();
  let before: { createdAt: Date; id: string } | undefined;
  if (q.cursor) {
    const [at, id] = decodeCursor(q.cursor, CURSOR_SORT).v;
    before = { createdAt: new Date(String(at)), id: String(id) };
  }
  const rows = await ctx.store.audit.list({
    actor: q.actor,
    entityType: q.entity_type,
    operation: q.operation,
    entityId: q.entity_id,
    from: q.from ? zonedInstant(q.from, 0, org.timezone) : undefined,
    // "to" is inclusive: everything before the next local midnight.
    to: q.to ? zonedInstant(shiftDate(q.to, 1), 0, org.timezone) : undefined,
    before,
    limit: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > q.limit && last
        ? encodeCursor({ s: CURSOR_SORT, v: [last.createdAt.toISOString(), last.id] })
        : null,
  };
}

export async function listAuditActors(ctx: ServiceContext) {
  assertCan(ctx.actor, "audit.view");
  return ctx.store.audit.actors();
}

/** The operation of an action: "job.update" → "update", "auth.sign_in" → "sign_in". */
export function auditOperation(action: string): string {
  return action.slice(action.lastIndexOf(".") + 1);
}

/** Columns that say nothing a reader needs: ids and bookkeeping. */
const HIDDEN_FIELDS = new Set(["id", "organization_id", "created_at", "updated_at", "version"]);

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * The fields an entry changed, in a stable order. Updates log only changed columns; inserts and deletes log
 * the whole row, so empty values are left out of those.
 */
export function auditChanges(entry: Pick<AuditEntryRecord, "before" | "after">): AuditChange[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const isUpdate = entry.before !== null && entry.after !== null;
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (f) => !HIDDEN_FIELDS.has(f),
  );
  return fields
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }))
    .filter((c) => isUpdate || !isEmpty(c.before) || !isEmpty(c.after));
}

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && v !== null && Object.keys(v).length === 0)
  );
}

/** Records a staff sign-in or sign-out (AUD-01) in the organization of the transaction. */
export async function recordAuthEvent(
  store: Store,
  event: "sign_in" | "sign_out",
  userId: string,
): Promise<void> {
  await store.audit.record({ action: `auth.${event}`, entityType: "user", entityId: userId });
}
