import type {
  JobListFilters,
  JobRecord,
  JobRepo,
  JobView,
  Page,
  AssigneeRef,
  JobEventRecord,
} from "@fieldops/core";
import { decodeCursor, encodeCursor, parseJobNumber, parseSort, PRIORITY_RANK } from "@fieldops/core";
import {
  JOB_STATUSES,
  type HoldReason,
  type JobEventType,
  type JobPriority,
  type JobSource,
  type JobStatus,
  type AiStatus,
  type SlaState,
} from "@fieldops/shared";
import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import {
  checklistItem,
  customer,
  job,
  jobAssignment,
  jobEvent,
  member,
  orgCounter,
  serviceType,
  site,
  user,
} from "../schema";
import { definedOnly, likeEscape, toAddress } from "./util";
import { currentSlaState } from "./sla";

const SORT_FIELDS = ["number", "scheduled_start", "created_at", "priority", "status", "title"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const priorityRank = sql`(case ${job.priority} when 'low' then 0 when 'normal' then 1 when 'high' then 2 else 3 end)`;
const statusRank = sql.raw(
  `(case "job"."status" ${JOB_STATUSES.map((s, i) => `when '${s}' then ${i}`).join(" ")} else 99 end)`,
);

function sortExpr(field: SortField, desc: boolean): SQL {
  switch (field) {
    case "number":
      return sql`${job.number}`;
    case "created_at":
      return sql`${job.createdAt}`;
    case "title":
      return sql`lower(${job.title})`;
    case "priority":
      return priorityRank;
    case "status":
      return statusRank;
    case "scheduled_start":
      // Unscheduled jobs sort last in both directions.
      return desc
        ? sql`coalesce(${job.scheduledStart}, '-infinity'::timestamptz)`
        : sql`coalesce(${job.scheduledStart}, 'infinity'::timestamptz)`;
  }
}

function sortValue(field: SortField, desc: boolean, row: JobRecord): string | number {
  switch (field) {
    case "number":
      return row.number;
    case "created_at":
      return row.createdAt.toISOString();
    case "title":
      return row.title.toLowerCase();
    case "priority":
      return PRIORITY_RANK[row.priority];
    case "status":
      return JOB_STATUSES.indexOf(row.status);
    case "scheduled_start":
      return row.scheduledStart?.toISOString() ?? (desc ? "-infinity" : "infinity");
  }
}

function castValue(field: SortField, v: string | number | null): SQL {
  if (field === "created_at" || field === "scheduled_start") return sql`${v}::timestamptz`;
  return sql`${v}`;
}

const assigneesSql = sql<AssigneeRef[]>`coalesce((
  select json_agg(json_build_object('memberId', m.id, 'userId', u.id, 'name', u.name, 'isLead', ja.is_lead) order by ja.is_lead desc, u.name)
  from ${jobAssignment} ja
  join ${member} m on m.id = ja.member_id
  join ${user} u on u.id = m.user_id
  where ja.job_id = "job"."id" and ja.organization_id = "job"."organization_id"
), '[]'::json)`;

export const viewColumns = {
  j: job,
  customerName: customer.name,
  site: site,
  serviceTypeName: serviceType.name,
  assignees: assigneesSql,
};

export type ViewRow = {
  j: typeof job.$inferSelect;
  customerName: string;
  site: typeof site.$inferSelect;
  serviceTypeName: string | null;
  assignees: AssigneeRef[];
};

export function toJobRecord(r: typeof job.$inferSelect): JobRecord {
  return {
    id: r.id,
    number: r.number,
    customerId: r.customerId,
    siteId: r.siteId,
    equipmentId: r.equipmentId,
    serviceTypeId: r.serviceTypeId,
    title: r.title,
    description: r.description,
    priority: r.priority as JobPriority,
    status: r.status as JobStatus,
    source: r.source as JobSource,
    holdReason: (r.holdReason as HoldReason | null) ?? null,
    preferredStart: r.preferredStart,
    preferredEnd: r.preferredEnd,
    scheduledStart: r.scheduledStart,
    scheduledEnd: r.scheduledEnd,
    completedAt: r.completedAt,
    canceledAt: r.canceledAt,
    estimatedDurationMin: r.estimatedDurationMin,
    firstScheduledAt: r.firstScheduledAt,
    revisit: r.revisit,
    aiDrafted: r.aiDrafted,
    needsReview: r.needsReview,
    aiStatus: (r.aiStatus as AiStatus | null) ?? null,
    slaPolicyId: r.slaPolicyId,
    responseDueAt: r.responseDueAt,
    resolutionDueAt: r.resolutionDueAt,
    responseAtRiskAt: r.responseAtRiskAt,
    resolutionAtRiskAt: r.resolutionAtRiskAt,
    slaResponseState: (r.slaResponseState as SlaState | null) ?? null,
    slaResolutionState: (r.slaResolutionState as SlaState | null) ?? null,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    version: r.version,
  };
}

export function toView(r: ViewRow): JobView {
  return {
    ...toJobRecord(r.j),
    customer: { id: r.j.customerId, name: r.customerName },
    site: {
      id: r.site.id,
      label: r.site.label,
      address: toAddress(r.site),
      latitude: r.site.latitude,
      longitude: r.site.longitude,
      accessNotes: r.site.accessNotes,
    },
    serviceType:
      r.j.serviceTypeId && r.serviceTypeName ? { id: r.j.serviceTypeId, name: r.serviceTypeName } : null,
    assignees: r.assignees,
  };
}

export function jobRepo(tx: Tx, orgId: string): JobRepo {
  const scope = and(eq(job.organizationId, orgId), isNull(job.deletedAt));

  const baseView = () =>
    tx
      .select(viewColumns)
      .from(job)
      .innerJoin(customer, and(eq(customer.id, job.customerId), eq(customer.organizationId, orgId)))
      .innerJoin(site, and(eq(site.id, job.siteId), eq(site.organizationId, orgId)))
      .leftJoin(
        serviceType,
        and(eq(serviceType.id, job.serviceTypeId), eq(serviceType.organizationId, orgId)),
      );

  async function getWhere(where: SQL | undefined): Promise<JobView | null> {
    const [r] = await baseView().where(and(scope, where));
    return r ? toView(r as ViewRow) : null;
  }

  return {
    async list(f: JobListFilters): Promise<Page<JobView>> {
      const where: (SQL | undefined)[] = [scope];
      if (f.q) {
        const n = parseJobNumber(f.q);
        const q = `%${likeEscape(f.q)}%`;
        where.push(or(ilike(job.title, q), ilike(customer.name, q), n ? eq(job.number, n) : undefined));
      }
      if (f.status?.length) where.push(inArray(job.status, f.status));
      if (f.priority?.length) where.push(inArray(job.priority, f.priority));
      if (f.service_type) where.push(eq(job.serviceTypeId, f.service_type));
      if (f.customer) where.push(eq(job.customerId, f.customer));
      const memberFilter = f.assignedMemberId ?? f.technician;
      if (memberFilter) {
        where.push(
          sql`exists (select 1 from ${jobAssignment} ja where ja.organization_id = ${orgId} and ja.job_id = "job"."id" and ja.member_id = ${memberFilter})`,
        );
      }
      // Technicians who filter by another technician still only see their own jobs.
      if (f.assignedMemberId && f.technician && f.technician !== f.assignedMemberId) where.push(sql`false`);
      if (f.unassigned) {
        where.push(
          sql`not exists (select 1 from ${jobAssignment} ja where ja.organization_id = ${orgId} and ja.job_id = "job"."id")`,
        );
      }
      if (f.revisit) where.push(eq(job.revisit, true));
      if (f.needs_review) where.push(eq(job.needsReview, true));
      if (f.sla?.length) {
        where.push(
          sql`${currentSlaState('"job"')} in (${sql.join(
            f.sla.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        );
      }
      const tz = sql`(select o.timezone from organization o where o.id = ${orgId})`;
      const dateCol =
        f.date_field === "created"
          ? sql`${job.createdAt}`
          : f.date_field === "completed"
            ? sql`${job.completedAt}`
            : sql`coalesce(${job.scheduledStart}, ${job.createdAt})`;
      if (f.from) where.push(sql`${dateCol} >= (${f.from}::date)::timestamp at time zone ${tz}`);
      if (f.to) where.push(sql`${dateCol} < ((${f.to}::date) + 1)::timestamp at time zone ${tz}`);

      const sorts = parseSort(f.sort, SORT_FIELDS);
      const orderBy = [
        ...sorts.map((s) => sql`${sortExpr(s.field, s.desc)} ${sql.raw(s.desc ? "desc" : "asc")}`),
      ];
      const lastDesc = sorts.at(-1)?.desc ?? true;
      orderBy.push(sql`${job.id} ${sql.raw(lastDesc ? "desc" : "asc")}`);

      if (f.cursor && !f.page) {
        const c = decodeCursor(f.cursor, f.sort);
        const values = c.v;
        // Lexicographic keyset condition that works for mixed sort directions:
        // (a > va) or (a = va and b > vb) or ... and finally the id tie-breaker.
        const keys = [
          ...sorts.map((s) => ({
            expr: sortExpr(s.field, s.desc),
            desc: s.desc,
            field: s.field as SortField | "id",
          })),
          { expr: sql`${job.id}`, desc: lastDesc, field: "id" as const },
        ];
        const ors: SQL[] = [];
        keys.forEach((k, i) => {
          const eqs = keys
            .slice(0, i)
            .map(
              (p, j) =>
                sql`${p.expr} = ${p.field === "id" ? sql`${values[j]}::uuid` : castValue(p.field, values[j] ?? null)}`,
            );
          const v = k.field === "id" ? sql`${values[i]}::uuid` : castValue(k.field, values[i] ?? null);
          const cmp = k.desc ? sql`${k.expr} < ${v}` : sql`${k.expr} > ${v}`;
          ors.push(and(...eqs, cmp)!);
        });
        where.push(or(...ors));
      }

      const condition = and(...where);
      const offset = f.page ? (f.page - 1) * f.limit : 0;
      const rows = (await baseView()
        .where(condition)
        .orderBy(...orderBy)
        .limit(f.limit + 1)
        .offset(offset)) as ViewRow[];
      const hasMore = rows.length > f.limit;
      const views = rows.slice(0, f.limit).map(toView);
      const last = views.at(-1);

      let total: number | null = null;
      if (f.page) {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(job)
          .innerJoin(customer, and(eq(customer.id, job.customerId), eq(customer.organizationId, orgId)))
          .where(condition);
        total = t?.n ?? 0;
      }
      return {
        rows: views,
        nextCursor:
          hasMore && last && !f.page
            ? encodeCursor({ s: f.sort, v: [...sorts.map((s) => sortValue(s.field, s.desc, last)), last.id] })
            : null,
        total,
      };
    },

    get: (id) => getWhere(eq(job.id, id)),
    getByNumber: (number) => getWhere(eq(job.number, number)),

    async nextNumber() {
      const [r] = await tx
        .insert(orgCounter)
        .values({ organizationId: orgId, name: "job", value: 1 })
        .onConflictDoUpdate({
          target: [orgCounter.organizationId, orgCounter.name],
          set: { value: sql`${orgCounter.value} + 1` },
        })
        .returning({ value: orgCounter.value });
      return r!.value;
    },

    async create(data) {
      const [r] = await tx
        .insert(job)
        .values({ organizationId: orgId, ...data, status: "new" })
        .returning();
      return toJobRecord(r!);
    },

    async update(id, patch, expectedVersion) {
      const [r] = await tx
        .update(job)
        .set(definedOnly({ ...patch, version: sql`${job.version} + 1`, updatedAt: new Date() }))
        .where(
          and(
            scope,
            eq(job.id, id),
            expectedVersion !== undefined ? eq(job.version, expectedVersion) : undefined,
          ),
        )
        .returning();
      return r ? toJobRecord(r) : null;
    },

    async softDelete(id) {
      const r = await tx
        .update(job)
        .set({ deletedAt: new Date() })
        .where(and(scope, eq(job.id, id)))
        .returning({ id: job.id });
      return r.length > 0;
    },

    async setAssignments(jobId, assignments) {
      await tx
        .delete(jobAssignment)
        .where(and(eq(jobAssignment.organizationId, orgId), eq(jobAssignment.jobId, jobId)));
      if (assignments.length) {
        await tx.insert(jobAssignment).values(
          assignments.map((a) => ({
            organizationId: orgId,
            jobId,
            memberId: a.memberId,
            isLead: a.isLead,
          })),
        );
      }
    },

    async addEvent(e) {
      await tx.insert(jobEvent).values({
        organizationId: orgId,
        jobId: e.jobId,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorUserId: e.actorUserId,
        payload: e.payload,
      });
    },

    async events(jobId): Promise<JobEventRecord[]> {
      const rows = await tx
        .select({ e: jobEvent, actorName: user.name })
        .from(jobEvent)
        .leftJoin(user, eq(user.id, jobEvent.actorUserId))
        .where(and(eq(jobEvent.organizationId, orgId), eq(jobEvent.jobId, jobId)))
        .orderBy(sql`${jobEvent.createdAt} desc`, sql`${jobEvent.id} desc`);
      return rows.map(({ e, actorName }) => ({
        id: e.id,
        jobId: e.jobId,
        type: e.type as JobEventType,
        fromStatus: (e.fromStatus as JobStatus | null) ?? null,
        toStatus: (e.toStatus as JobStatus | null) ?? null,
        actor: e.actorUserId && actorName ? { id: e.actorUserId, name: actorName } : null,
        payload: e.payload as Record<string, unknown>,
        createdAt: e.createdAt,
      }));
    },

    async overlapping(memberId, start, end, excludeJobId) {
      return tx
        .select({ id: job.id, number: job.number })
        .from(job)
        .innerJoin(
          jobAssignment,
          and(eq(jobAssignment.jobId, job.id), eq(jobAssignment.organizationId, orgId)),
        )
        .where(
          and(
            scope,
            eq(jobAssignment.memberId, memberId),
            sql`${job.id} <> ${excludeJobId}`,
            sql`${job.status} not in ('completed','canceled')`,
            sql`${job.scheduledStart} < ${end.toISOString()}::timestamptz`,
            sql`${job.scheduledEnd} > ${start.toISOString()}::timestamptz`,
          ),
        );
    },

    async missingRequiredChecklistItems(jobId) {
      const rows = await tx
        .select({ label: checklistItem.label })
        .from(checklistItem)
        .where(
          and(
            eq(checklistItem.organizationId, orgId),
            eq(checklistItem.jobId, jobId),
            eq(checklistItem.required, true),
            isNull(checklistItem.doneAt),
          ),
        );
      return rows.map((r) => r.label);
    },
  };
}
