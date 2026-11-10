import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Tx;

// timestamptz → Date and bigint → number are handled by drizzle column modes; numeric stays a string.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function createDb(url: string, opts: { max?: number; application?: string } = {}) {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    application_name: opts.application ?? "fieldops",
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Who is making a change, for the audit log (AUD-01). Unset fields are logged as empty (system changes). */
export interface TxContext {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Runs `fn` in a transaction scoped to one organization. `app.org_id` is set with is_local = true, so it
 * only lives for this transaction, and row-level security limits every tenant table to that organization.
 * The actor, IP address and user agent go into `app.user_id`, `app.ip` and `app.ua` the same way; the audit
 * trigger reads them (ADR 016).
 */
export async function withTenant<T>(
  db: Database,
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
  context: TxContext = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.org_id', ${organizationId}, true),
      set_config('app.user_id', ${context.userId ?? ""}, true),
      set_config('app.ip', ${context.ip ?? ""}, true),
      set_config('app.ua', ${context.userAgent ?? ""}, true)`);
    return fn(tx);
  });
}

/**
 * Turns off the audit trigger and live events for the current transaction. Only for bulk writes that aren't
 * user actions: the demo seed, the nightly reset and data migrations.
 */
export async function quiet(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('app.quiet', 'on', true)`);
}
