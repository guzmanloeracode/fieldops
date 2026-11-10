import "server-only";
import { schema } from "@fieldops/db";
import type { Role } from "@fieldops/shared";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "./db";

export interface Membership {
  organizationId: string;
  name: string;
  slug: string;
  role: Role;
}

/** Every organization the user belongs to, oldest membership first (AUTH-06). */
export const listMemberships = cache(async (userId: string): Promise<Membership[]> => {
  const rows = await db
    .select({
      organizationId: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
});
