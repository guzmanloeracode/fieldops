import type {
  MemberRepo,
  OrganizationRecord,
  OrganizationRepo,
  ServiceTypeRecord,
  ServiceTypeRepo,
} from "@fieldops/core";
import type { Address, Currency, Role } from "@fieldops/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { member, organization, serviceType, user } from "../schema";
import { definedOnly } from "./util";

export function toOrganization(r: typeof organization.$inferSelect): OrganizationRecord {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    logo: r.logo,
    timezone: r.timezone,
    currency: r.currency as Currency,
    country: r.country,
    brandColor: r.brandColor,
    address: (r.address as Address | null) ?? null,
    businessHours: r.businessHours as OrganizationRecord["businessHours"],
    taxRates: r.taxRates as OrganizationRecord["taxRates"],
    isDemo: r.isDemo,
  };
}

export function organizationRepo(tx: Tx, orgId: string): OrganizationRepo {
  return {
    async get() {
      const [r] = await tx.select().from(organization).where(eq(organization.id, orgId));
      if (!r) throw new Error("Organization not found");
      return toOrganization(r);
    },
    async update(patch) {
      const [r] = await tx
        .update(organization)
        .set(definedOnly({ ...patch, updatedAt: new Date() }))
        .where(eq(organization.id, orgId))
        .returning();
      return toOrganization(r!);
    },
  };
}

export function memberRepo(tx: Tx, orgId: string): MemberRepo {
  const select = () =>
    tx
      .select({
        id: member.id,
        userId: member.userId,
        name: user.name,
        email: user.email,
        role: member.role,
        isDemo: user.isDemo,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId));
  const map = (r: Awaited<ReturnType<ReturnType<typeof select>["execute"]>>[number]) => ({
    ...r,
    role: r.role as Role,
  });
  return {
    async list() {
      const rows = await select()
        .where(eq(member.organizationId, orgId))
        .orderBy(
          sql`case ${member.role} when 'owner' then 0 when 'admin' then 1 when 'dispatcher' then 2 else 3 end`,
          asc(user.name),
        );
      return rows.map(map);
    },
    async get(memberId) {
      const [r] = await select().where(and(eq(member.organizationId, orgId), eq(member.id, memberId)));
      return r ? map(r) : null;
    },
    async updateRole(memberId, role) {
      await tx
        .update(member)
        .set({ role })
        .where(and(eq(member.organizationId, orgId), eq(member.id, memberId)));
    },
    async remove(memberId) {
      await tx.delete(member).where(and(eq(member.organizationId, orgId), eq(member.id, memberId)));
    },
    async countByRole(role) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.role, role)));
      return r?.n ?? 0;
    },
  };
}

function toServiceType(r: typeof serviceType.$inferSelect): ServiceTypeRecord {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    defaultDurationMin: r.defaultDurationMin,
    defaultPriceMinor: r.defaultPriceMinor,
    currency: r.currency as Currency,
    color: r.color,
    active: r.active,
  };
}

export function serviceTypeRepo(tx: Tx, orgId: string): ServiceTypeRepo {
  const scope = eq(serviceType.organizationId, orgId);
  return {
    async list(opts) {
      const rows = await tx
        .select()
        .from(serviceType)
        .where(and(scope, opts?.includeInactive ? undefined : eq(serviceType.active, true)))
        .orderBy(asc(serviceType.name));
      return rows.map(toServiceType);
    },
    async get(id) {
      const [r] = await tx
        .select()
        .from(serviceType)
        .where(and(scope, eq(serviceType.id, id)));
      return r ? toServiceType(r) : null;
    },
    async create(data) {
      const [r] = await tx
        .insert(serviceType)
        .values({ organizationId: orgId, ...data })
        .returning();
      return toServiceType(r!);
    },
    async update(id, patch) {
      const [r] = await tx
        .update(serviceType)
        .set(definedOnly({ ...patch, updatedAt: new Date() }))
        .where(and(scope, eq(serviceType.id, id)))
        .returning();
      return r ? toServiceType(r) : null;
    },
  };
}
