import { JOB_PRIORITIES, slaPoliciesUpdateSchema, type JobPriority } from "@fieldops/shared";
import { assertCan } from "../domain/permissions";
import { defaultTargets, slaDeadlines, slaState, type SlaTargets } from "../domain/sla";
import { notify } from "./notify";
import type { NotificationMailer } from "./notification-types";
import { parseInput } from "./validate";
import type { JobRecord, JobSlaField, ServiceContext, Store } from "./types";

// SLA policies, deadlines on jobs and the monitor (SLA-01 – SLA-03).

export interface EffectivePolicy extends SlaTargets {
  priority: JobPriority;
  /** The stored policy, or null when the defaults apply. */
  id: string | null;
  isDefault: boolean;
}

/** One policy per priority: the organization's own, or the calendar-time defaults. */
export async function effectivePolicies(store: Store): Promise<EffectivePolicy[]> {
  const stored = await store.sla.listPolicies();
  return JOB_PRIORITIES.map((priority) => {
    const p = stored.find((x) => x.priority === priority);
    return p
      ? {
          priority,
          id: p.id,
          isDefault: false,
          responseMin: p.responseMin,
          resolutionMin: p.resolutionMin,
          businessHours: p.businessHours,
        }
      : { priority, id: null, isDefault: true, ...defaultTargets(priority) };
  });
}

/** Everyone in the organization can read the targets their jobs are measured against. */
export async function listPolicies(ctx: ServiceContext): Promise<EffectivePolicy[]> {
  assertCan(ctx.actor, "jobs.view", { assigned: true });
  return effectivePolicies(ctx.store);
}

/** Saves all four priorities at once (owners and admins). Existing jobs keep their deadlines. */
export async function updatePolicies(ctx: ServiceContext, raw: unknown): Promise<EffectivePolicy[]> {
  assertCan(ctx.actor, "sla.manage");
  const input = parseInput(slaPoliciesUpdateSchema, raw);
  await ctx.store.sla.savePolicies(
    input.policies.map((p) => ({
      priority: p.priority,
      responseMin: p.response_min,
      resolutionMin: p.resolution_min,
      businessHours: p.business_hours,
    })),
  );
  return effectivePolicies(ctx.store);
}

type SlaFields = Pick<JobRecord, JobSlaField>;

/** Deadlines for a priority, counted from `createdAt` with the organization's policy and business hours. */
async function deadlinesFor(store: Store, priority: JobPriority, createdAt: Date) {
  const [org, policies] = await Promise.all([store.organization.get(), effectivePolicies(store)]);
  const policy = policies.find((p) => p.priority === priority)!;
  return {
    slaPolicyId: policy.id,
    ...slaDeadlines({ createdAt, policy, businessHours: org.businessHours, timeZone: org.timezone }),
  };
}

/** SLA fields for a job being created now (SLA-02). */
export async function slaForNewJob(
  ctx: Pick<ServiceContext, "store" | "now">,
  priority: JobPriority,
  createdAt: Date = ctx.now,
): Promise<SlaFields> {
  const d = await deadlinesFor(ctx.store, priority, createdAt);
  return {
    ...d,
    slaResponseState: slaState({
      dueAt: d.responseDueAt,
      atRiskAt: d.responseAtRiskAt,
      doneAt: null,
      now: ctx.now,
    }),
    slaResolutionState: slaState({
      dueAt: d.resolutionDueAt,
      atRiskAt: d.resolutionAtRiskAt,
      doneAt: null,
      now: ctx.now,
    }),
  };
}

/**
 * SLA fields after a change to a job, to merge into the update. A new priority recomputes the deadlines from
 * the creation time; the states follow the result: first scheduled → response met or breached, completed →
 * resolution met or breached, reopened → back to the live state, canceled → none.
 */
export async function refreshSla(
  ctx: Pick<ServiceContext, "store" | "now">,
  job: JobRecord,
  patch: Partial<JobRecord>,
): Promise<Partial<SlaFields>> {
  const next = { ...job, ...patch };
  const deadlines =
    patch.priority !== undefined && patch.priority !== job.priority
      ? await deadlinesFor(ctx.store, next.priority, job.createdAt)
      : null;
  const d = { ...job, ...deadlines };
  const canceled = next.status === "canceled";
  return {
    ...deadlines,
    slaResponseState: canceled
      ? null
      : slaState({
          dueAt: d.responseDueAt,
          atRiskAt: d.responseAtRiskAt,
          doneAt: next.firstScheduledAt,
          now: ctx.now,
        }),
    slaResolutionState: canceled
      ? null
      : slaState({
          dueAt: d.resolutionDueAt,
          atRiskAt: d.resolutionAtRiskAt,
          doneAt: next.status === "completed" ? next.completedAt : null,
          now: ctx.now,
        }),
  };
}

/**
 * The SLA monitor (SLA-03), run every 5 minutes per organization. Moves open jobs along their deadlines, then
 * notifies about alerts raised for the first time: at risk → dispatchers; breached → dispatchers and owners.
 * Idempotent: a second run at the same time changes and raises nothing.
 */
export async function monitorSla(deps: {
  store: Store;
  mailer?: NotificationMailer;
  now: Date;
}): Promise<{ updated: number; alerts: number }> {
  const { store, mailer, now } = deps;
  const updated = await store.sla.advanceStates(now);
  const alerts = await store.sla.raiseAlerts(now);
  if (alerts.length > 0) {
    const members = await store.members.list();
    const usersOf = (roles: readonly string[]) =>
      members.filter((m) => roles.includes(m.role)).map((m) => m.userId);
    // Without a dispatcher, the managers hear about it instead.
    const dispatchers = usersOf(["dispatcher"]).length
      ? usersOf(["dispatcher"])
      : usersOf(["owner", "admin"]);
    const owners = usersOf(["owner"]);
    for (const a of alerts) {
      const breached = a.kind === "breached";
      await notify(
        { store, mailer },
        {
          event: breached ? "sla_breached" : "sla_at_risk",
          userIds: breached ? [...dispatchers, ...owners] : dispatchers,
          payload: {
            job_id: a.jobId,
            job_number: a.number,
            job_title: a.title,
            customer_name: a.customerName,
            target: a.target,
            ...(a.dueAt ? { due_at: a.dueAt.toISOString() } : {}),
          },
        },
      );
    }
  }
  return { updated, alerts: alerts.length };
}
