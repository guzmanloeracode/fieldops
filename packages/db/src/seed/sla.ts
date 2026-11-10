import {
  slaDeadlines,
  slaState,
  type SlaDeadlines,
  type SlaTargets,
  type WorkingHours,
} from "@fieldops/core";
import { JOB_PRIORITIES, type JobPriority, type SlaState } from "@fieldops/shared";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { insertBatches } from "./time";

// SLA policies, deadlines, states and past alerts (SLA-01 – SLA-03).
//
// The core seed picks a priority independently of how fast a job was handled, which would breach most urgent
// and high SLAs. Here the priority follows the work instead: a job keeps its priority when its timeline meets
// that priority's targets, and otherwise takes the most urgent priority it does meet. About 8% of completed
// jobs keep a priority they missed (PRD §19: about 8% SLA breaches). Open jobs are all on track except a few
// picked to be at risk or breached right now, so the board and the dashboard have something to show.

type Policies = Record<JobPriority, SlaTargets>;

/** Acme Air (Austin): calendar time, except low priority, which counts business hours (Mon–Fri 08–17). */
const POLICIES: Record<SeedContext["spec"]["key"], Policies> = {
  "acme-air": {
    urgent: { responseMin: 3 * 60, resolutionMin: 24 * 60, businessHours: false },
    high: { responseMin: 4 * 60, resolutionMin: 5 * 24 * 60, businessHours: false },
    normal: { responseMin: 24 * 60, resolutionMin: 10 * 24 * 60, businessHours: false },
    low: { responseMin: 24 * 60, resolutionMin: 108 * 60, businessHours: true },
  },
  // Acme Teknik (Jakarta): urgent and high around the clock, the rest in business hours (Mon–Fri, Sat morning).
  "acme-teknik": {
    urgent: { responseMin: 3 * 60, resolutionMin: 24 * 60, businessHours: false },
    high: { responseMin: 8 * 60, resolutionMin: 5 * 24 * 60, businessHours: false },
    normal: { responseMin: 9 * 60, resolutionMin: 72 * 60, businessHours: true },
    low: { responseMin: 18 * 60, resolutionMin: 120 * 60, businessHours: true },
  },
};

/** Most urgent first, so a job "takes the most urgent priority it meets". */
const URGENCY: JobPriority[] = [...JOB_PRIORITIES].reverse();

const BREACH_SHARE = 0.09;
const OPEN_AT_RISK = 3;
const OPEN_BREACHED = 2;

type Row = {
  id: string;
  number: number;
  priority: JobPriority;
  status: string;
  created_at: Date;
  first_scheduled_at: Date | null;
  scheduled_start: Date | null;
  scheduled_end: Date | null;
  completed_at: Date | null;
};

interface Planned extends SlaDeadlines {
  priority: JobPriority;
  policyId: string;
  response: SlaState | null;
  resolution: SlaState | null;
}

export async function seedSla(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 4);
  const policies = POLICIES[ctx.spec.key];
  const [org] = await ctx.tx
    .select({ businessHours: s.organization.businessHours })
    .from(s.organization)
    .where(sql`${s.organization.id} = ${ctx.orgId}`);
  const businessHours = (org?.businessHours ?? []) as WorkingHours[];

  const policyIds = {} as Record<JobPriority, string>;
  await ctx.tx.insert(s.slaPolicy).values(
    JOB_PRIORITIES.map((priority) => {
      policyIds[priority] = uuidv7();
      return { id: policyIds[priority], organizationId: ctx.orgId, priority, ...policies[priority] };
    }),
  );

  const res = await ctx.tx.execute<Row>(sql`
    select id, number, priority, status, created_at, first_scheduled_at, scheduled_start, scheduled_end, completed_at
      from job where organization_id = ${ctx.orgId} and deleted_at is null order by number`);
  const rows = res.rows.map((r) => ({
    ...r,
    created_at: new Date(r.created_at),
    first_scheduled_at: r.first_scheduled_at ? new Date(r.first_scheduled_at) : null,
    scheduled_start: r.scheduled_start ? new Date(r.scheduled_start) : null,
    scheduled_end: r.scheduled_end ? new Date(r.scheduled_end) : null,
    completed_at: r.completed_at ? new Date(r.completed_at) : null,
  }));

  const now = ctx.now;
  const cache = new Map<string, SlaDeadlines>();
  const deadlines = (row: Row, priority: JobPriority) => {
    const key = `${row.id}|${priority}`;
    let d = cache.get(key);
    if (!d) {
      d = slaDeadlines({
        createdAt: row.created_at,
        policy: policies[priority],
        businessHours,
        timeZone: ctx.timeZone,
      });
      cache.set(key, d);
    }
    return d;
  };
  const plan = (row: Row, priority: JobPriority): Planned => {
    const d = deadlines(row, priority);
    const canceled = row.status === "canceled";
    return {
      priority,
      policyId: policyIds[priority],
      ...d,
      response: canceled
        ? null
        : slaState({
            dueAt: d.responseDueAt,
            atRiskAt: d.responseAtRiskAt,
            doneAt: row.first_scheduled_at,
            now,
          }),
      resolution: canceled
        ? null
        : slaState({
            dueAt: d.resolutionDueAt,
            atRiskAt: d.resolutionAtRiskAt,
            doneAt: row.status === "completed" ? row.completed_at : null,
            now,
          }),
    };
  };
  /** Meets both targets, judging open work by its visit end (or now while it isn't scheduled). */
  const fits = (row: Row, priority: JobPriority) => {
    const d = deadlines(row, priority);
    const responded = row.first_scheduled_at ?? now;
    const resolved = row.completed_at ?? row.scheduled_end ?? now;
    return responded <= d.responseDueAt && resolved <= d.resolutionDueAt;
  };
  const bestFit = (row: Row) => URGENCY.find((p) => fits(row, p)) ?? "low";

  const planned = new Map<string, Planned>();
  const open: Row[] = [];
  for (const row of rows) {
    if (row.status === "completed") {
      // Same random draw for every completed job, so the stream doesn't depend on the data.
      const breach = f.number.float({ min: 0, max: 1 }) < BREACH_SHARE;
      const missed = breach ? URGENCY.filter((p) => !fits(row, p)) : [];
      const priority = fits(row, row.priority)
        ? breach && missed.length
          ? missed.at(-1)!
          : row.priority
        : breach
          ? row.priority
          : bestFit(row);
      planned.set(row.id, plan(row, priority));
    } else if (row.status === "canceled") {
      planned.set(row.id, plan(row, row.priority));
    } else {
      open.push(row);
      planned.set(row.id, plan(row, fits(row, row.priority) ? row.priority : bestFit(row)));
    }
  }

  // A few open jobs that need attention now: at risk first, then breached, from today's work.
  const HALF_DAY = 12 * 3_600_000;
  const today = (r: Row) =>
    !r.scheduled_start || Math.abs(r.scheduled_start.getTime() - now.getTime()) <= HALF_DAY;
  const candidates = f.helpers.shuffle(open.filter(today));
  let atRisk = 0;
  let breached = 0;
  for (const row of candidates) {
    if (atRisk >= OPEN_AT_RISK && breached >= OPEN_BREACHED) break;
    const options = URGENCY.map((p) => plan(row, p));
    const worst = (p: Planned) =>
      p.response === "breached" || p.resolution === "breached"
        ? "breached"
        : p.response === "at_risk" || p.resolution === "at_risk"
          ? "at_risk"
          : null;
    const risky = options.find((p) => worst(p) === "at_risk");
    const late = options.find((p) => worst(p) === "breached");
    if (atRisk < OPEN_AT_RISK && risky) {
      planned.set(row.id, risky);
      atRisk += 1;
    } else if (breached < OPEN_BREACHED && late) {
      planned.set(row.id, late);
      breached += 1;
    }
  }

  // Write the priorities, deadlines and states in batches.
  const entries = rows.map((r) => [r, planned.get(r.id)!] as const);
  for (let i = 0; i < entries.length; i += 500) {
    const batch = entries.slice(i, i + 500);
    const values = sql.join(
      batch.map(
        ([r, p]) =>
          sql`(${r.id}::uuid, ${p.priority}, ${p.policyId}::uuid, ${p.responseDueAt}::timestamptz, ${p.resolutionDueAt}::timestamptz,
               ${p.responseAtRiskAt}::timestamptz, ${p.resolutionAtRiskAt}::timestamptz, ${p.response}, ${p.resolution})`,
      ),
      sql`, `,
    );
    await ctx.tx.execute(sql`
      update job set priority = v.priority, sla_policy_id = v.policy_id,
             response_due_at = v.response_due, resolution_due_at = v.resolution_due,
             response_at_risk_at = v.response_risk, resolution_at_risk_at = v.resolution_risk,
             sla_response_state = v.response, sla_resolution_state = v.resolution
        from (values ${values}) as v(id, priority, policy_id, response_due, resolution_due, response_risk,
                                     resolution_risk, response, resolution)
       where job.organization_id = ${ctx.orgId} and job.id = v.id`);
  }

  // Past alerts, so the monitor's first run after a reset doesn't announce history (SLA-03).
  const alerts: (typeof s.slaAlert.$inferInsert)[] = [];
  for (const [r, p] of entries) {
    if (r.status === "canceled") continue;
    const targets = [
      {
        target: "response",
        risk: p.responseAtRiskAt,
        due: p.responseDueAt,
        end: r.first_scheduled_at ?? now,
      },
      {
        target: "resolution",
        risk: p.resolutionAtRiskAt,
        due: p.resolutionDueAt,
        end: (r.status === "completed" ? r.completed_at : null) ?? now,
      },
    ];
    for (const t of targets) {
      if (t.risk <= t.end && t.risk <= now)
        alerts.push({
          organizationId: ctx.orgId,
          jobId: r.id,
          target: t.target,
          kind: "at_risk",
          raisedAt: t.risk,
        });
      if (t.due < t.end)
        alerts.push({
          organizationId: ctx.orgId,
          jobId: r.id,
          target: t.target,
          kind: "breached",
          raisedAt: t.due,
        });
    }
  }
  await insertBatches(ctx.tx, s.slaAlert, alerts);
}
