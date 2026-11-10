import type { SavedViewRecord, SavedViewRepo } from "@fieldops/core";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { member, savedView, user } from "../schema";

export function savedViewRepo(tx: Tx, orgId: string): SavedViewRepo {
  const select = () =>
    tx
      .select({ v: savedView, ownerName: user.name })
      .from(savedView)
      .innerJoin(member, eq(member.id, savedView.memberId))
      .innerJoin(user, eq(user.id, member.userId));
  const map = (r: { v: typeof savedView.$inferSelect; ownerName: string }): SavedViewRecord => ({
    id: r.v.id,
    memberId: r.v.memberId,
    ownerName: r.ownerName,
    resource: r.v.resource,
    name: r.v.name,
    query: r.v.query,
    shared: r.v.shared,
    createdAt: r.v.createdAt,
  });
  return {
    async list(resource, memberId) {
      const rows = await select()
        .where(
          and(
            eq(savedView.organizationId, orgId),
            eq(savedView.resource, resource),
            or(eq(savedView.memberId, memberId), eq(savedView.shared, true)),
          ),
        )
        .orderBy(desc(sql`${savedView.memberId} = ${memberId}`), asc(sql`lower(${savedView.name})`));
      return rows.map(map);
    },
    async get(id) {
      const [r] = await select().where(and(eq(savedView.organizationId, orgId), eq(savedView.id, id)));
      return r ? map(r) : null;
    },
    async create(data) {
      const [r] = await tx
        .insert(savedView)
        .values({ organizationId: orgId, ...data })
        .returning({ id: savedView.id });
      return (await this.get(r!.id))!;
    },
    async remove(id) {
      const rows = await tx
        .delete(savedView)
        .where(and(eq(savedView.organizationId, orgId), eq(savedView.id, id)))
        .returning({ id: savedView.id });
      return rows.length > 0;
    },
    async countByMember(memberId, resource) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(savedView)
        .where(
          and(
            eq(savedView.organizationId, orgId),
            eq(savedView.memberId, memberId),
            eq(savedView.resource, resource),
          ),
        );
      return Number(r?.n ?? 0);
    },
  };
}
