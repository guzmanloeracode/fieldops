import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/**
 * Fixed-window counter in the rate_limit table (PLT-04). Returns false once `key` was used more than `limit`
 * times in the current window. One upsert per call; the worker deletes old windows.
 */
export async function allowRequest(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const r = await db.execute<{ count: number }>(sql`
    insert into rate_limit (key, window_start, count)
    values (${key}, date_bin(${`${windowSeconds} seconds`}::interval, now(), timestamptz '2000-01-01'), 1)
    on conflict (key, window_start) do update set count = rate_limit.count + 1
    returning count`);
  return Number(r.rows[0]?.count ?? 0) <= limit;
}
