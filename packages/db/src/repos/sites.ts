import type { EquipmentRepo, SiteRecord, SiteRepo } from "@fieldops/core";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { equipment, job, jobAssignment, site } from "../schema";
import { definedOnly, fromAddress, toAddress } from "./util";

export function toSite(r: typeof site.$inferSelect): SiteRecord {
  return {
    id: r.id,
    customerId: r.customerId,
    label: r.label,
    address: toAddress(r),
    latitude: r.latitude,
    longitude: r.longitude,
    accessNotes: r.accessNotes,
    onsiteContactName: r.onsiteContactName,
    onsiteContactPhone: r.onsiteContactPhone,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function siteRepo(tx: Tx, orgId: string): SiteRepo {
  const scope = and(eq(site.organizationId, orgId), isNull(site.deletedAt));
  return {
    async listByCustomer(customerId) {
      const rows = await tx
        .select()
        .from(site)
        .where(and(scope, eq(site.customerId, customerId)))
        .orderBy(asc(site.createdAt));
      return rows.map(toSite);
    },
    async get(id) {
      const [r] = await tx
        .select()
        .from(site)
        .where(and(scope, eq(site.id, id)));
      return r ? toSite(r) : null;
    },
    async create(customerId, data) {
      const [r] = await tx
        .insert(site)
        .values({
          organizationId: orgId,
          customerId,
          label: data.label,
          ...fromAddress(data.address),
          latitude: data.latitude,
          longitude: data.longitude,
          accessNotes: data.accessNotes,
          onsiteContactName: data.onsiteContactName,
          onsiteContactPhone: data.onsiteContactPhone,
        })
        .returning();
      return toSite(r!);
    },
    async update(id, patch) {
      const { address, ...rest } = patch;
      const [r] = await tx
        .update(site)
        .set(definedOnly({ ...rest, ...(address ? fromAddress(address) : {}), updatedAt: new Date() }))
        .where(and(scope, eq(site.id, id)))
        .returning();
      return r ? toSite(r) : null;
    },
    async isLinkedToMember(siteId, memberId) {
      const [r] = await tx
        .select({ id: job.id })
        .from(job)
        .innerJoin(
          jobAssignment,
          and(eq(jobAssignment.jobId, job.id), eq(jobAssignment.organizationId, orgId)),
        )
        .where(
          and(
            eq(job.organizationId, orgId),
            eq(job.siteId, siteId),
            isNull(job.deletedAt),
            eq(jobAssignment.memberId, memberId),
          ),
        )
        .limit(1);
      return Boolean(r);
    },
  };
}

export function equipmentRepo(tx: Tx, orgId: string): EquipmentRepo {
  const scope = and(eq(equipment.organizationId, orgId), isNull(equipment.deletedAt));
  const map = (r: typeof equipment.$inferSelect) => ({
    id: r.id,
    siteId: r.siteId,
    type: r.type,
    brand: r.brand,
    model: r.model,
    serial: r.serial,
    installDate: r.installDate,
    warrantyEnd: r.warrantyEnd,
  });
  return {
    async get(id) {
      const [r] = await tx
        .select()
        .from(equipment)
        .where(and(scope, eq(equipment.id, id)));
      return r ? map(r) : null;
    },
    async listBySite(siteId) {
      const rows = await tx
        .select()
        .from(equipment)
        .where(and(scope, eq(equipment.siteId, siteId)))
        .orderBy(asc(equipment.type), sql`${equipment.installDate} nulls last`);
      return rows.map(map);
    },
  };
}
