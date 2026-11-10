import type { EquipmentHistoryRow, EquipmentRepo, SiteRecord, SiteRepo } from "@fieldops/core";
import type { JobPriority, JobStatus } from "@fieldops/shared";
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
    notes: r.notes,
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
    async create(siteId, data) {
      const [r] = await tx
        .insert(equipment)
        .values({ organizationId: orgId, siteId, ...data })
        .returning();
      return map(r!);
    },
    async update(id, patch) {
      const [r] = await tx
        .update(equipment)
        .set(definedOnly({ ...patch, updatedAt: new Date() }))
        .where(and(scope, eq(equipment.id, id)))
        .returning();
      return r ? map(r) : null;
    },
    async softDelete(id) {
      const rows = await tx
        .update(equipment)
        .set({ deletedAt: new Date() })
        .where(and(scope, eq(equipment.id, id)))
        .returning({ id: equipment.id });
      return rows.length > 0;
    },
    async history(id, opts) {
      const me = opts.assignedMemberId ?? null;
      const res = await tx.execute<{
        id: string;
        number: number;
        title: string;
        status: JobStatus;
        priority: JobPriority;
        service_type_name: string | null;
        scheduled_start: Date | string | null;
        completed_at: Date | string | null;
        created_at: Date | string;
        technicians: string[];
      }>(sql`
        select j.id, j.number, j.title, j.status, j.priority, st.name as service_type_name,
               j.scheduled_start, j.completed_at, j.created_at,
               coalesce((
                 select array_agg(u.name order by ja.is_lead desc, u.name)
                   from job_assignment ja
                   join member m on m.id = ja.member_id
                   join "user" u on u.id = m.user_id
                  where ja.organization_id = ${orgId} and ja.job_id = j.id
               ), '{}') as technicians
          from job j
          left join service_type st on st.id = j.service_type_id
         where j.organization_id = ${orgId} and j.deleted_at is null and j.equipment_id = ${id}
           and (${me}::uuid is null or exists (
             select 1 from job_assignment ja where ja.organization_id = ${orgId} and ja.job_id = j.id and ja.member_id = ${me}::uuid))
         order by j.created_at desc
         limit ${opts.limit}`);
      const date = (v: Date | string | null) => (v ? new Date(v) : null);
      return res.rows.map((r): EquipmentHistoryRow => ({
        id: r.id,
        number: Number(r.number),
        title: r.title,
        status: r.status,
        priority: r.priority,
        serviceTypeName: r.service_type_name,
        scheduledStart: date(r.scheduled_start),
        completedAt: date(r.completed_at),
        createdAt: new Date(r.created_at),
        technicians: r.technicians,
      }));
    },
  };
}
