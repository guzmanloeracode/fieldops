import type { SlaAlertRaised, SlaPolicyRecord, SlaRepo } from "@fieldops/core";
import type { JobPriority, SlaTarget } from "@fieldops/shared";
import { eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { slaPolicy } from "../schema";

// SLA policies and the monitor's queries (SLA-01 – SLA-03).

const rank = (col: string) =>
  `(case ${col} when 'breached' then 3 when 'at_risk' then 2 when 'on_track' then 1 else 0 end)`;

/** True while the response target is the one to show: never scheduled and at least as bad as the resolution. */
const responseFirst = (p: string) =>
  `${p}.status <> 'completed' and ${p}.first_scheduled_at is null and ${p}.sla_response_state is not null
    and ${rank(`${p}.sla_response_state`)} >= ${rank(`${p}.sla_resolution_state`)}`;

/**
 * The job's current SLA state as SQL, for the table alias `p` (e.g. `j` or `"job"`): the worse of its open
 * targets, the response while the job has never been scheduled, the resolution outcome once completed and
 * nothing when canceled. Mirrors `currentSla()` in @fieldops/core.
 */
export function currentSlaState(p: string): SQL {
  return sql.raw(`(case when ${p}.status = 'canceled' then null
    when ${responseFirst(p)} then ${p}.sla_response_state else ${p}.sla_resolution_state end)`);
}

/** Which target `currentSlaState` picked: 'response' or 'resolution'. */
export function currentSlaTarget(p: string): SQL {
  return sql.raw(`(case when ${responseFirst(p)} then 'response' else 'resolution' end)`);
}

/** The deadline of the target `currentSlaState` picked. */
export function currentSlaDue(p: string): SQL {
  return sql.raw(`(case when ${responseFirst(p)} then ${p}.response_due_at else ${p}.resolution_due_at end)`);
}

/** The live state of an open target at `now` from its stored at-risk point and deadline. */
const liveState = (due: string, risk: string, now: Date) =>
  sql`(case when ${now}::timestamptz > ${sql.raw(due)} then 'breached'
            when ${sql.raw(risk)} is not null and ${now}::timestamptz >= ${sql.raw(risk)} then 'at_risk'
            else 'on_track' end)`;

export function slaRepo(tx: Tx, orgId: string): SlaRepo {
  const toRecord = (r: typeof slaPolicy.$inferSelect): SlaPolicyRecord => ({
    id: r.id,
    priority: r.priority as JobPriority,
    responseMin: r.responseMin,
    resolutionMin: r.resolutionMin,
    businessHours: r.businessHours,
  });

  return {
    async listPolicies() {
      const rows = await tx.select().from(slaPolicy).where(eq(slaPolicy.organizationId, orgId));
      return rows.map(toRecord);
    },

    async savePolicies(rows) {
      if (rows.length === 0) return [];
      const saved = await tx
        .insert(slaPolicy)
        .values(rows.map((r) => ({ organizationId: orgId, ...r })))
        .onConflictDoUpdate({
          target: [slaPolicy.organizationId, slaPolicy.priority],
          set: {
            responseMin: sql`excluded.response_min`,
            resolutionMin: sql`excluded.resolution_min`,
            businessHours: sql`excluded.business_hours`,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      return saved.map(toRecord);
    },

    async advanceStates(now) {
      const res = await tx.execute(sql`
        with next as (
          select j.id,
                 case when j.first_scheduled_at is null and j.response_due_at is not null
                      then ${liveState("j.response_due_at", "j.response_at_risk_at", now)}
                      else j.sla_response_state end as response,
                 -- A paused resolution clock (SLA-04) doesn't move.
                 case when j.resolution_due_at is not null and j.sla_paused_at is null
                      then ${liveState("j.resolution_due_at", "j.resolution_at_risk_at", now)}
                      else j.sla_resolution_state end as resolution
            from job j
           where j.organization_id = ${orgId} and j.deleted_at is null
             and j.status not in ('completed', 'canceled')
        )
        update job set sla_response_state = next.response, sla_resolution_state = next.resolution
          from next
         where job.organization_id = ${orgId} and job.id = next.id
           and (job.sla_response_state is distinct from next.response
             or job.sla_resolution_state is distinct from next.resolution)`);
      return res.rowCount ?? 0;
    },

    async raiseAlerts(now) {
      const res = await tx.execute<{
        job_id: string;
        target: SlaTarget;
        kind: "at_risk" | "breached";
        number: number;
        title: string;
        customer_name: string;
        due_at: Date | string | null;
      }>(sql`
        with candidates as (
          select j.id as job_id, 'response' as target, j.sla_response_state as kind
            from job j
           where j.organization_id = ${orgId} and j.deleted_at is null
             and j.status not in ('completed', 'canceled') and j.first_scheduled_at is null
             and j.sla_response_state in ('at_risk', 'breached')
          union all
          select j.id, 'resolution', j.sla_resolution_state
            from job j
           where j.organization_id = ${orgId} and j.deleted_at is null
             and j.status not in ('completed', 'canceled') and j.sla_paused_at is null
             and j.sla_resolution_state in ('at_risk', 'breached')
        ), raised as (
          insert into sla_alert (organization_id, job_id, target, kind, raised_at)
          select ${orgId}, job_id, target, kind, ${now} from candidates
          on conflict do nothing
          returning job_id, target, kind
        )
        select r.job_id, r.target, r.kind, j.number, j.title, c.name as customer_name,
               case when r.target = 'response' then j.response_due_at else j.resolution_due_at end as due_at
          from raised r
          join job j on j.id = r.job_id and j.organization_id = ${orgId}
          join customer c on c.id = j.customer_id
         order by due_at nulls last, j.number, r.target`);
      return res.rows.map((r): SlaAlertRaised => ({
        jobId: r.job_id,
        number: Number(r.number),
        title: r.title,
        customerName: r.customer_name,
        target: r.target,
        kind: r.kind,
        dueAt: r.due_at ? new Date(r.due_at) : null,
      }));
    },
  };
}
