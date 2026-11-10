import {
  digestByDefault,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_EVENTS_BY_ROLE,
  notificationListQuerySchema,
  notificationPreferencesUpdateSchema,
  notificationReadSchema,
  type NotificationEvent,
  type NotificationPayload,
  type Role,
} from "@fieldops/shared";
import { ValidationError } from "../domain/errors";
import { formatJobNumber } from "../domain/numbering";
import { can } from "../domain/permissions";
import type { ExpenseView } from "./expense-types";
import { notify } from "./notify";
import { parseInput } from "./validate";
import type { JobView, ServiceContext } from "./types";

// The notification center (NOT-01), preferences (NOT-03) and the producers for job and expense events. Every
// query is for the signed-in user's own rows: the user id always comes from the session, never from input.

// ------------------------------------------------------------------ links

/** Where a notification leads in the app. Job events open the job; the rest fall back to a list. */
export function notificationHref(type: NotificationEvent, payload: NotificationPayload): string {
  if (type === "quote_decided" && payload.quote_number) return `/quotes/${payload.quote_number}`;
  if (type === "payment_received" && payload.invoice_id) return `/invoices/${payload.invoice_id}`;
  if (payload.job_number !== undefined) return `/jobs/${formatJobNumber(payload.job_number)}`;
  if (type === "expense_requested" || type === "expense_decided") return "/approvals";
  return "/notifications";
}

// ------------------------------------------------------------------ producers

type JobRef = Pick<
  JobView,
  "id" | "number" | "title" | "customer" | "scheduledStart" | "scheduledEnd" | "assignees"
>;

const deps = (ctx: ServiceContext) => ({ store: ctx.store, mailer: ctx.mailer });

function jobPayload(ctx: ServiceContext, job: JobRef): NotificationPayload {
  return {
    job_id: job.id,
    job_number: job.number,
    job_title: job.title,
    customer_name: job.customer.name,
    actor_name: ctx.actor.name,
    ...(job.scheduledStart ? { scheduled_start: job.scheduledStart.toISOString() } : {}),
  };
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * After an assignment: technicians added to the job get "job_assigned"; technicians who were already on it
 * get "job_rescheduled" when the window of a scheduled visit moved. The dispatcher who made the change isn't
 * notified.
 */
export async function afterAssignment(ctx: ServiceContext, before: JobRef, after: JobRef): Promise<void> {
  const previous = new Set(before.assignees.map((a) => a.userId));
  const added = after.assignees.filter((a) => !previous.has(a.userId)).map((a) => a.userId);
  const kept = after.assignees.filter((a) => previous.has(a.userId)).map((a) => a.userId);
  const payload = jobPayload(ctx, after);
  if (added.length > 0) {
    await notify(deps(ctx), {
      event: "job_assigned",
      userIds: added,
      payload,
      exceptUserId: ctx.actor.userId,
    });
  }
  const moved =
    before.scheduledStart !== null &&
    after.scheduledStart !== null &&
    (!sameTime(before.scheduledStart, after.scheduledStart) ||
      !sameTime(before.scheduledEnd, after.scheduledEnd));
  if (moved && kept.length > 0) {
    await notify(deps(ctx), {
      event: "job_rescheduled",
      userIds: kept,
      payload,
      exceptUserId: ctx.actor.userId,
    });
  }
}

function expensePayload(ctx: ServiceContext, expense: ExpenseView): NotificationPayload {
  return {
    job_id: expense.job.id,
    job_number: expense.job.number,
    job_title: expense.job.title,
    expense_id: expense.id,
    item: expense.item,
    actor_name: ctx.actor.name,
  };
}

/** A pending request goes to everyone who may approve its amount (EXP-02). Auto-approved ones don't. */
export async function afterExpenseRequested(ctx: ServiceContext, expense: ExpenseView): Promise<void> {
  if (expense.status !== "pending") return;
  const org = await ctx.store.organization.get();
  const below = expense.totalMinor < org.settings.approval.dispatcherLimitMinor;
  const approvers = (await ctx.store.members.list())
    .filter((m) => can(m, "expenses.approve", { belowDispatcherThreshold: below }))
    .map((m) => m.userId);
  await notify(deps(ctx), {
    event: "expense_requested",
    userIds: approvers,
    payload: expensePayload(ctx, expense),
    exceptUserId: ctx.actor.userId,
  });
}

/** The requester learns the decision. */
export async function afterExpenseDecided(ctx: ServiceContext, expense: ExpenseView): Promise<void> {
  if (!expense.requesterMemberId || (expense.status !== "approved" && expense.status !== "rejected")) return;
  const requester = await ctx.store.members.get(expense.requesterMemberId);
  if (!requester) return;
  await notify(deps(ctx), {
    event: "expense_decided",
    userIds: [requester.userId],
    payload: { ...expensePayload(ctx, expense), decision: expense.status },
    exceptUserId: ctx.actor.userId,
  });
}

// ------------------------------------------------------------------ center (NOT-01)

export async function listNotifications(ctx: ServiceContext, raw: unknown) {
  const q = parseInput(notificationListQuerySchema, raw ?? {});
  return ctx.store.notifications.list({
    userId: ctx.actor.userId,
    unreadOnly: q.unread,
    limit: q.limit,
    cursor: q.cursor,
    page: q.page,
  });
}

export async function countUnread(ctx: ServiceContext): Promise<number> {
  return ctx.store.notifications.unreadCount(ctx.actor.userId);
}

export async function markRead(ctx: ServiceContext, raw: unknown): Promise<number> {
  const input = parseInput(notificationReadSchema, raw);
  return ctx.store.notifications.markRead(ctx.actor.userId, "all" in input ? "all" : input.ids, ctx.now);
}

// ------------------------------------------------------------------ preferences (NOT-03)

export interface PreferenceRow {
  event: NotificationEvent;
  /** Null when the event has no in-app notification (the daily digest). */
  inApp: boolean | null;
  /** Null when the event has no email. */
  email: boolean | null;
}

/** The default email choice of a role: the daily digest is on for owners only (NOT-04). */
function defaultEmail(event: NotificationEvent, role: Role): boolean | null {
  const d = NOTIFICATION_DEFAULTS[event].email;
  return d !== null && event === "daily_digest" ? digestByDefault(role) : d;
}

/** The events the user's role can receive, with their stored choices or the defaults. */
export async function getPreferences(ctx: ServiceContext): Promise<PreferenceRow[]> {
  const stored = new Map(
    (await ctx.store.notifications.userPreferences(ctx.actor.userId)).map((p) => [p.event, p]),
  );
  return NOTIFICATION_EVENTS_BY_ROLE[ctx.actor.role].map((event) => {
    const d = NOTIFICATION_DEFAULTS[event];
    const s = stored.get(event);
    return {
      event,
      inApp: d.inApp === null ? null : (s?.inApp ?? d.inApp),
      email: d.email === null ? null : (s?.email ?? defaultEmail(event, ctx.actor.role)),
    };
  });
}

export async function updatePreferences(ctx: ServiceContext, raw: unknown): Promise<PreferenceRow[]> {
  const input = parseInput(notificationPreferencesUpdateSchema, raw);
  const allowed = new Set<NotificationEvent>(NOTIFICATION_EVENTS_BY_ROLE[ctx.actor.role]);
  const current = new Map((await getPreferences(ctx)).map((p) => [p.event, p]));
  const rows = input.preferences.map((p, i) => {
    if (!allowed.has(p.event)) {
      throw new ValidationError("You don't receive this notification", [
        { path: `preferences.${i}.event`, message: "Not available for your role" },
      ]);
    }
    const hasEmail = NOTIFICATION_DEFAULTS[p.event].email !== null;
    return {
      event: p.event,
      // Email-only events store false for the channel they don't have.
      inApp: NOTIFICATION_DEFAULTS[p.event].inApp !== null && p.in_app === true,
      // Events without email store false; a missing value keeps the current choice.
      email: hasEmail ? (p.email ?? current.get(p.event)?.email ?? false) === true : false,
    };
  });
  await ctx.store.notifications.savePreferences(ctx.actor.userId, rows);
  return getPreferences(ctx);
}
