import {
  DEFAULT_APPROVAL_THRESHOLDS,
  type Currency,
  type NotificationEvent,
  type NotificationPayload,
} from "@fieldops/shared";
import { sql } from "drizzle-orm";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { DAY, insertBatches } from "./time";

/** How far back the seeded notifications go. Older ones would have been read and forgotten. */
const WINDOW_DAYS = 7;

interface Row {
  userId: string;
  type: NotificationEvent;
  payload: NotificationPayload;
  createdAt: Date;
}

/**
 * Recent notifications for every member (NOT-01): technicians' assignments and reschedules, approvers'
 * pending requests and requesters' decisions, and — when the portal and SLA seeds produced them — portal
 * requests and SLA alerts for the office. Older ones are read, the last day's mostly unread. Preferences keep
 * their defaults (no rows). Offset 7.
 */
export async function seedNotifications(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 7);
  const now = ctx.now.getTime();
  const since = now - WINDOW_DAYS * DAY;
  const recent = (d: Date | null | undefined) => Boolean(d && d.getTime() >= since && d.getTime() <= now);
  const memberById = new Map(ctx.members.map((m) => [m.id, m]));
  const userByMember = (id: string | null | undefined) => (id ? memberById.get(id)?.userId : undefined);
  const office = (roles: string[]) => ctx.members.filter((m) => roles.includes(m.role)).map((m) => m.userId);
  const customerName = new Map(ctx.customers.map((c) => [c.id, c.name]));
  const dispatcher = ctx.members.find((m) => m.role === "dispatcher") ?? ctx.members[0]!;
  const rows: Row[] = [];
  const jobPayload = (j: SeedContext["jobs"][number]): NotificationPayload => ({
    job_id: j.id,
    job_number: j.number,
    job_title: j.title,
    customer_name: customerName.get(j.customerId) ?? undefined,
    ...(j.scheduledStart ? { scheduled_start: new Date(j.scheduledStart).toISOString() } : {}),
  });

  // Assignments: the last "assigned" event of each job in the window, for each technician on it.
  for (const j of ctx.jobs) {
    const assigned = j.events.filter((e) => e.type === "assigned" && recent(e.createdAt as Date)).at(-1);
    if (!assigned) continue;
    const actor = ctx.members.find((m) => m.userId === assigned.actorUserId) ?? dispatcher;
    for (const a of j.assignees) {
      const userId = userByMember(a.memberId);
      if (!userId || userId === assigned.actorUserId) continue;
      rows.push({
        userId,
        type: "job_assigned",
        payload: { ...jobPayload(j), actor_name: actor.name },
        createdAt: assigned.createdAt as Date,
      });
    }
  }

  // A few reschedules of upcoming visits, told in the last two days.
  const upcoming = ctx.jobs.filter(
    (j) => j.status === "scheduled" && j.scheduledStart && new Date(j.scheduledStart).getTime() > now,
  );
  for (const j of f.helpers.arrayElements(upcoming, Math.min(upcoming.length, 6))) {
    const at = new Date(now - f.number.int({ min: 20, max: 2 * 24 * 60 }) * 60_000);
    for (const a of j.assignees) {
      const userId = userByMember(a.memberId);
      if (userId)
        rows.push({
          userId,
          type: "job_rescheduled",
          payload: { ...jobPayload(j), actor_name: dispatcher.name },
          createdAt: at,
        });
    }
  }

  // Parts and expenses from the expenses seed: pending ones to their approvers, decisions to the requester.
  const currency: Currency = ctx.spec.currency;
  const limit = DEFAULT_APPROVAL_THRESHOLDS[currency].dispatcherLimitMinor;
  const expenses = await ctx.tx.execute<{
    id: string;
    job_id: string;
    item: string;
    status: string;
    total_minor: number;
    requester_member_id: string | null;
    decided_by_member_id: string | null;
    created_at: Date;
    decided_at: Date | null;
    auto_approved: boolean;
  }>(sql`select id, job_id, item, status, total_minor::bigint as total_minor, requester_member_id,
           decided_by_member_id, created_at, decided_at, auto_approved
         from expense_request
         where organization_id = ${ctx.orgId}
           and (created_at >= ${new Date(since)} or decided_at >= ${new Date(since)})
         order by created_at, id`);
  const jobById = new Map(ctx.jobs.map((j) => [j.id, j]));
  for (const e of expenses.rows) {
    const j = jobById.get(e.job_id);
    if (!j) continue;
    const requester = e.requester_member_id ? memberById.get(e.requester_member_id) : undefined;
    const base = { ...jobPayload(j), expense_id: e.id, item: e.item };
    const createdAt = new Date(e.created_at);
    if (e.status === "pending" && recent(createdAt)) {
      const approvers = [
        ...office(["owner", "admin"]),
        ...(Number(e.total_minor) < limit ? office(["dispatcher"]) : []),
      ];
      for (const userId of approvers) {
        if (userId === requester?.userId) continue;
        rows.push({
          userId,
          type: "expense_requested",
          payload: { ...base, actor_name: requester?.name },
          createdAt,
        });
      }
    }
    const decidedAt = e.decided_at ? new Date(e.decided_at) : null;
    if (
      (e.status === "approved" || e.status === "rejected") &&
      !e.auto_approved &&
      recent(decidedAt) &&
      requester
    ) {
      const decider = e.decided_by_member_id ? memberById.get(e.decided_by_member_id) : undefined;
      if (decider?.userId === requester.userId) continue;
      rows.push({
        userId: requester.userId,
        type: "expense_decided",
        payload: { ...base, decision: e.status, actor_name: decider?.name },
        createdAt: decidedAt!,
      });
    }
  }

  // Portal requests (portal seed) and SLA alerts (SLA seed), when those seeds ran before this one.
  // Only requests still waiting for review, or from the last two days: older ones were handled long ago.
  const portal = await ctx.tx.execute<{ id: string; created_at: Date }>(
    sql`select id, created_at from job where organization_id = ${ctx.orgId} and source = 'portal'
        and deleted_at is null
        and (needs_review or created_at >= ${new Date(now - 2 * DAY)}) and created_at >= ${new Date(since)}
        order by created_at, id`,
  );
  for (const p of portal.rows) {
    const j = jobById.get(p.id);
    const payload = j ? jobPayload(j) : { job_id: p.id };
    for (const userId of office(["dispatcher"])) {
      rows.push({ userId, type: "portal_request", payload, createdAt: new Date(p.created_at) });
    }
  }
  const alerts = await ctx.tx.execute<{
    job_id: string;
    target: "response" | "resolution";
    kind: "at_risk" | "breached";
    raised_at: Date;
    response_due_at: Date | null;
    resolution_due_at: Date | null;
  }>(
    sql`select a.job_id, a.target, a.kind, a.raised_at, j.response_due_at, j.resolution_due_at
        from sla_alert a join job j on j.id = a.job_id and j.organization_id = a.organization_id
        where a.organization_id = ${ctx.orgId} and a.raised_at >= ${new Date(since)}
        order by a.raised_at, a.job_id, a.target, a.kind`,
  );
  for (const a of alerts.rows) {
    const j = jobById.get(a.job_id);
    if (!j) continue;
    const due = a.target === "response" ? a.response_due_at : a.resolution_due_at;
    const recipients = a.kind === "breached" ? office(["dispatcher", "owner"]) : office(["dispatcher"]);
    for (const userId of recipients) {
      rows.push({
        userId,
        type: a.kind === "breached" ? "sla_breached" : "sla_at_risk",
        payload: {
          ...jobPayload(j),
          target: a.target,
          ...(due ? { due_at: new Date(due).toISOString() } : {}),
        },
        createdAt: new Date(a.raised_at),
      });
    }
  }

  // Older than a day: read a little after arrival. The last day: mostly unread. Everyone's two newest from
  // the last two days stay unread, so each demo role opens on something new.
  const sorted = rows
    .filter((r) => r.createdAt.getTime() <= now)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const newest = new Set<Row>();
  for (const userId of new Set(sorted.map((r) => r.userId))) {
    for (const r of sorted.filter((x) => x.userId === userId).slice(-2)) {
      if (now - r.createdAt.getTime() < 2 * DAY) newest.add(r);
    }
  }
  const values = sorted.map((r) => {
    const age = now - r.createdAt.getTime();
    const chance = f.number.float({ min: 0, max: 1 });
    const read = !newest.has(r) && (age > DAY ? chance < 0.9 : chance < 0.25);
    const readAt = read
      ? new Date(Math.min(now, r.createdAt.getTime() + f.number.int({ min: 2, max: 240 }) * 60_000))
      : null;
    return {
      organizationId: ctx.orgId,
      userId: r.userId,
      type: r.type,
      payload: r.payload,
      createdAt: r.createdAt,
      readAt,
    };
  });
  await insertBatches(ctx.tx, s.notification, values);
}
