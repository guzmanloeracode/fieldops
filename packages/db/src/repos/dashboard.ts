import type {
  DashboardRepo,
  KpiTotals,
  PendingApprovalRow,
  ReportFilters,
  RiskRow,
  ServiceTypeCountRow,
  SlaBucketRow,
  StatusBucketRow,
  WorkloadRow,
} from "@fieldops/core";
import type { JobPriority, JobStatus, SlaTarget } from "@fieldops/shared";
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { currentSlaDue, currentSlaState, currentSlaTarget } from "./sla";

// Dashboard aggregations (DSH-01 – DSH-04, DSH-06). Each query filters by organization first and ranges on
// an indexed column: created_at, completed_at or scheduled_start (job_org_*_idx), or expense status.
// Local dates become instants in the organization's time zone, so "today" means the business's day.
// SLA figures use the deadlines and states stored on each job (SLA-02).

const startOf = (date: string, tz: string) => sql`((${date}::date)::timestamp at time zone ${tz})`;
const endOf = (date: string, tz: string) => sql`(((${date}::date) + 1)::timestamp at time zone ${tz})`;
const bucketSql = (bucket: "day" | "week") => sql.raw(bucket === "week" ? "'week'" : "'day'");

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function dashboardRepo(tx: Tx, orgId: string): DashboardRepo {
  /** Tenant, soft-delete and optional technician / service type filters on the alias `j`. */
  const scope = (f: Pick<ReportFilters, "technicianId" | "serviceTypeId">): SQL => {
    const parts: SQL[] = [sql`j.organization_id = ${orgId}`, sql`j.deleted_at is null`];
    if (f.serviceTypeId) parts.push(sql`j.service_type_id = ${f.serviceTypeId}`);
    if (f.technicianId) {
      parts.push(
        sql`exists (select 1 from job_assignment ja where ja.organization_id = ${orgId} and ja.job_id = j.id and ja.member_id = ${f.technicianId})`,
      );
    }
    return sql.join(parts, sql` and `);
  };
  const inRange = (col: SQL, f: ReportFilters) =>
    sql`${col} >= ${startOf(f.from, f.timeZone)} and ${col} < ${endOf(f.to, f.timeZone)}`;

  return {
    async kpis(f): Promise<KpiTotals> {
      const res = await tx.execute<Record<string, unknown>>(sql`
        select r.created, r.avg_response, r.response_met, r.response_measured,
          c.completed, c.within_target, c.measured, c.first_visit, c.avg_resolution
        from (
          select count(*)::int as created,
                 (avg(extract(epoch from (j.first_scheduled_at - j.created_at)) / 60)
                   filter (where j.first_scheduled_at is not null))::float8 as avg_response,
                 (count(*) filter (where j.sla_response_state = 'met'))::int as response_met,
                 (count(*) filter (where j.sla_response_state in ('met', 'breached')))::int as response_measured
            from job j
           where ${scope(f)} and ${inRange(sql`j.created_at`, f)}
        ) r, (
          select count(*)::int as completed,
                 (count(*) filter (where j.sla_resolution_state = 'met'))::int as within_target,
                 (count(*) filter (where j.sla_resolution_state in ('met', 'breached')))::int as measured,
                 (count(*) filter (where not j.revisit))::int as first_visit,
                 avg(extract(epoch from (j.completed_at - j.created_at)) / 60)::float8 as avg_resolution
            from job j
           where ${scope(f)} and j.status = 'completed' and ${inRange(sql`j.completed_at`, f)}
        ) c`);
      const r = res.rows[0]!;
      return {
        created: Number(r.created),
        completed: Number(r.completed),
        completedWithinTarget: Number(r.within_target),
        completedSlaMeasured: Number(r.measured),
        responseMeasured: Number(r.response_measured),
        responseMet: Number(r.response_met),
        completedFirstVisit: Number(r.first_visit),
        avgResponseMin: num(r.avg_response),
        avgResolutionMin: num(r.avg_resolution),
      };
    },

    async statusSeries(f, bucket): Promise<StatusBucketRow[]> {
      const res = await tx.execute<{ bucket: string; status: JobStatus; count: number }>(sql`
        select to_char(date_trunc(${bucketSql(bucket)}, j.created_at at time zone ${f.timeZone}), 'YYYY-MM-DD') as bucket,
               j.status, count(*)::int as count
          from job j
         where ${scope(f)} and ${inRange(sql`j.created_at`, f)}
         group by 1, 2
         order by 1, 2`);
      return res.rows.map((r) => ({ bucket: r.bucket, status: r.status, count: Number(r.count) }));
    },

    async slaTrend(f, bucket): Promise<SlaBucketRow[]> {
      const res = await tx.execute<{
        bucket: string;
        completed: number;
        within_target: number;
        measured: number;
      }>(sql`
        select to_char(date_trunc(${bucketSql(bucket)}, j.completed_at at time zone ${f.timeZone}), 'YYYY-MM-DD') as bucket,
               count(*)::int as completed,
               (count(*) filter (where j.sla_resolution_state = 'met'))::int as within_target,
               (count(*) filter (where j.sla_resolution_state in ('met', 'breached')))::int as measured
          from job j
         where ${scope(f)} and j.status = 'completed' and ${inRange(sql`j.completed_at`, f)}
         group by 1
         order by 1`);
      return res.rows.map((r) => ({
        bucket: r.bucket,
        completed: Number(r.completed),
        withinTarget: Number(r.within_target),
        measured: Number(r.measured),
      }));
    },

    async byServiceType(f): Promise<ServiceTypeCountRow[]> {
      const res = await tx.execute<{
        service_type_id: string | null;
        name: string | null;
        created: number;
        completed: number;
      }>(sql`
        select x.service_type_id, st.name, sum(x.created)::int as created, sum(x.completed)::int as completed
          from (
            select j.service_type_id, 1 as created, 0 as completed
              from job j where ${scope(f)} and ${inRange(sql`j.created_at`, f)}
            union all
            select j.service_type_id, 0, 1
              from job j where ${scope(f)} and j.status = 'completed' and ${inRange(sql`j.completed_at`, f)}
          ) x
          left join service_type st on st.id = x.service_type_id and st.organization_id = ${orgId}
         group by x.service_type_id, st.name`);
      return res.rows.map((r) => ({
        serviceTypeId: r.service_type_id,
        name: r.name,
        created: Number(r.created),
        completed: Number(r.completed),
      }));
    },

    async workload(f): Promise<WorkloadRow[]> {
      const res = await tx.execute<{
        member_id: string;
        jobs: number;
        scheduled_min: number;
        completed: number;
      }>(sql`
        select ja.member_id,
               count(*)::int as jobs,
               coalesce(round(sum(extract(epoch from (j.scheduled_end - j.scheduled_start)) / 60)), 0)::int as scheduled_min,
               (count(*) filter (where j.status = 'completed'))::int as completed
          from job j
          join job_assignment ja on ja.job_id = j.id and ja.organization_id = ${orgId}
         where ${scope(f)} and j.status <> 'canceled' and j.scheduled_end is not null
           and ${inRange(sql`j.scheduled_start`, f)}
         group by ja.member_id`);
      return res.rows.map((r) => ({
        memberId: r.member_id,
        jobs: Number(r.jobs),
        scheduledMin: Number(r.scheduled_min),
        completed: Number(r.completed),
      }));
    },

    async dayStatusCounts(date, timeZone) {
      const f = { from: date, to: date, timeZone };
      const res = await tx.execute<{ status: JobStatus; count: number }>(sql`
        select j.status, count(*)::int as count
          from job j
         where ${scope({})} and ${inRange(sql`j.scheduled_start`, f)}
         group by j.status`);
      return res.rows.map((r) => ({ status: r.status, count: Number(r.count) }));
    },

    async atRisk(limit) {
      const res = await tx.execute<{
        id: string;
        number: number;
        title: string;
        status: JobStatus;
        priority: JobPriority;
        customer_name: string;
        created_at: Date | string;
        scheduled_end: Date | string | null;
        assignees: string[];
        target: SlaTarget;
        state: "at_risk" | "breached";
        due_at: Date | string | null;
        total: number;
      }>(sql`
        select j.id, j.number, j.title, j.status, j.priority, c.name as customer_name, j.created_at, j.scheduled_end,
               coalesce((
                 select array_agg(u.name order by ja.is_lead desc, u.name)
                   from job_assignment ja
                   join member m on m.id = ja.member_id
                   join "user" u on u.id = m.user_id
                  where ja.organization_id = ${orgId} and ja.job_id = j.id
               ), '{}') as assignees,
               ${currentSlaTarget("j")} as target, ${currentSlaState("j")} as state, ${currentSlaDue("j")} as due_at,
               (count(*) over ())::int as total
          from job j
          join customer c on c.id = j.customer_id
         where ${scope({})}
           and j.status not in ('completed', 'canceled')
           and ${currentSlaState("j")} in ('at_risk', 'breached')
         order by ${currentSlaDue("j")} asc nulls last, j.number asc
         limit ${limit}`);
      const rows: RiskRow[] = res.rows.map((r) => ({
        id: r.id,
        number: Number(r.number),
        title: r.title,
        status: r.status,
        priority: r.priority,
        customerName: r.customer_name,
        createdAt: new Date(r.created_at),
        scheduledEnd: r.scheduled_end ? new Date(r.scheduled_end) : null,
        assignees: r.assignees,
        target: r.target,
        state: r.state,
        dueAt: r.due_at ? new Date(r.due_at) : null,
      }));
      return { total: Number(res.rows[0]?.total ?? 0), rows };
    },

    async pendingApprovals(limit) {
      const res = await tx.execute<{
        id: string;
        item: string;
        total_minor: number | string;
        currency: string;
        requester_name: string | null;
        job_number: number;
        job_title: string;
        created_at: Date | string;
        total: number;
      }>(sql`
        select e.id, e.item, e.total_minor, e.currency, u.name as requester_name, j.number as job_number,
               j.title as job_title, e.created_at, (count(*) over ())::int as total
          from expense_request e
          join job j on j.id = e.job_id and j.organization_id = e.organization_id and j.deleted_at is null
          left join member m on m.id = e.requester_member_id
          left join "user" u on u.id = m.user_id
         where e.organization_id = ${orgId} and e.status = 'pending'
         order by e.created_at desc
         limit ${limit}`);
      const rows: PendingApprovalRow[] = res.rows.map((r) => ({
        id: r.id,
        item: r.item,
        totalMinor: Number(r.total_minor),
        currency: r.currency,
        requesterName: r.requester_name,
        jobNumber: Number(r.job_number),
        jobTitle: r.job_title,
        createdAt: new Date(r.created_at),
      }));
      return { total: Number(res.rows[0]?.total ?? 0), rows };
    },

    async ownStats(memberId, from, to, timeZone) {
      const f = { from, to, timeZone };
      const res = await tx.execute<{ completed: number; work_min: number }>(sql`
        select
          (select count(*)::int
             from job j
             join job_assignment ja on ja.job_id = j.id and ja.organization_id = ${orgId} and ja.member_id = ${memberId}
            where ${scope({})} and j.status = 'completed' and ${inRange(sql`j.completed_at`, f)}) as completed,
          (select coalesce(round(sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 60)), 0)::int
             from time_entry te
            where te.organization_id = ${orgId} and te.member_id = ${memberId} and te.kind = 'work'
              and ${inRange(sql`te.started_at`, f)}) as work_min`);
      const r = res.rows[0]!;
      return { completed: Number(r.completed), workMin: Number(r.work_min) };
    },
  };
}
