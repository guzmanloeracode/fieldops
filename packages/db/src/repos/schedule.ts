import type { AvailabilityRepo, ScheduleRepo, TimeOffRecord, WorkingHours } from "@fieldops/core";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { customer, job, jobAssignment, member, serviceType, site, timeOff } from "../schema";
import { toView, viewColumns, type ViewRow } from "./jobs";

// Scheduling and availability (SCH-01–05). Every query is scoped to the organization; RLS checks again.

function toTimeOff(r: typeof timeOff.$inferSelect): TimeOffRecord {
  return {
    id: r.id,
    memberId: r.memberId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    reason: r.reason,
    createdAt: r.createdAt,
  };
}

export function availabilityRepo(tx: Tx, orgId: string): AvailabilityRepo {
  const scope = eq(timeOff.organizationId, orgId);
  return {
    async updateMember(memberId, patch) {
      const set: { workingHours?: WorkingHours[] | null; skills?: string[] } = {};
      if (patch.workingHours !== undefined) set.workingHours = patch.workingHours;
      if (patch.skills !== undefined) set.skills = patch.skills;
      const where = and(eq(member.organizationId, orgId), eq(member.id, memberId));
      if (Object.keys(set).length === 0) {
        const [r] = await tx.select({ id: member.id }).from(member).where(where);
        return Boolean(r);
      }
      const r = await tx.update(member).set(set).where(where).returning({ id: member.id });
      return r.length > 0;
    },
    async listTimeOff({ from, to, memberIds }) {
      if (memberIds && memberIds.length === 0) return [];
      const rows = await tx
        .select()
        .from(timeOff)
        .where(
          and(
            scope,
            sql`${timeOff.startsAt} < ${to.toISOString()}::timestamptz`,
            sql`${timeOff.endsAt} > ${from.toISOString()}::timestamptz`,
            memberIds ? inArray(timeOff.memberId, memberIds) : undefined,
          ),
        )
        .orderBy(asc(timeOff.startsAt), asc(timeOff.id));
      return rows.map(toTimeOff);
    },
    async getTimeOff(id) {
      const [r] = await tx
        .select()
        .from(timeOff)
        .where(and(scope, eq(timeOff.id, id)));
      return r ? toTimeOff(r) : null;
    },
    async createTimeOff(data) {
      const [r] = await tx
        .insert(timeOff)
        .values({ organizationId: orgId, ...data })
        .returning();
      return toTimeOff(r!);
    },
    async removeTimeOff(id) {
      const r = await tx
        .delete(timeOff)
        .where(and(scope, eq(timeOff.id, id)))
        .returning({ id: timeOff.id });
      return r.length > 0;
    },
  };
}

/** Upper bound for one board query: a month of a busy organization fits comfortably. */
const MAX_BOARD_JOBS = 3000;

export function scheduleRepo(tx: Tx, orgId: string): ScheduleRepo {
  const scope = and(eq(job.organizationId, orgId), isNull(job.deletedAt));
  const views = () =>
    tx
      .select(viewColumns)
      .from(job)
      .innerJoin(customer, and(eq(customer.id, job.customerId), eq(customer.organizationId, orgId)))
      .innerJoin(site, and(eq(site.id, job.siteId), eq(site.organizationId, orgId)))
      .leftJoin(
        serviceType,
        and(eq(serviceType.id, job.serviceTypeId), eq(serviceType.organizationId, orgId)),
      );
  return {
    async scheduled({ from, to, memberId }) {
      const rows = (await views()
        .where(
          and(
            scope,
            sql`${job.status} <> 'canceled'`,
            sql`${job.scheduledStart} < ${to.toISOString()}::timestamptz`,
            sql`${job.scheduledEnd} > ${from.toISOString()}::timestamptz`,
            memberId
              ? sql`exists (select 1 from ${jobAssignment} ja where ja.organization_id = ${orgId} and ja.job_id = "job"."id" and ja.member_id = ${memberId})`
              : undefined,
          ),
        )
        .orderBy(asc(job.scheduledStart), asc(job.id))
        .limit(MAX_BOARD_JOBS)) as ViewRow[];
      return rows.map(toView);
    },
    async unscheduled(limit) {
      const rows = (await views()
        .where(and(scope, eq(job.status, "new"), isNull(job.scheduledStart)))
        .orderBy(
          sql`(case ${job.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end)`,
          asc(job.createdAt),
          asc(job.id),
        )
        .limit(limit)) as ViewRow[];
      return rows.map(toView);
    },
  };
}
