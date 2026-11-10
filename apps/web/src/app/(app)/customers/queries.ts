import "server-only";
import { withTenant } from "@fieldops/db";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/** Distinct customer tags in the organization, for the tag filter. */
export async function listCustomerTags(organizationId: string): Promise<string[]> {
  return withTenant(db, organizationId, async (tx) => {
    const res = await tx.execute<{ tag: string }>(
      sql`select distinct unnest(tags) as tag from customer where organization_id = ${organizationId} and deleted_at is null order by 1 limit 200`,
    );
    return res.rows.map((r) => r.tag);
  });
}
