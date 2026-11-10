import { describe, expect, it } from "vitest";
import { ValidationError } from "../domain/errors";
import { iso, world } from "../test/fixtures";
import { member } from "../test/memory-store";
import type { NotificationMailer } from "./notification-types";
import * as expenses from "./expenses";
import * as jobs from "./jobs";
import * as notifications from "./notifications";

type World = ReturnType<typeof world>;

const sent = (w: World) => w.data.automate?.notifications ?? [];
const of = (w: World, userId: string) => sent(w).filter((n) => n.userId === userId);

async function newJob(w: World) {
  return jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC leaking",
  });
}

async function assign(
  w: World,
  jobId: string,
  memberIds: string[],
  start: number | null,
  end: number | null,
) {
  return jobs.assignJob(w.ctx(w.dispatcher), jobId, {
    member_ids: memberIds,
    scheduled_start: start === null ? null : iso(start),
    scheduled_end: end === null ? null : iso(end),
  });
}

describe("job notifications", () => {
  it("tells newly assigned technicians, not the dispatcher who assigned them", async () => {
    const w = world();
    const job = await newJob(w);
    await assign(w, job.id, [w.tom.id, w.dispatcher.id], 9, 11);
    expect(of(w, w.dispatcher.userId)).toEqual([]);
    expect(of(w, w.tom.userId)).toEqual([
      expect.objectContaining({
        type: "job_assigned",
        readAt: null,
        payload: {
          job_id: job.id,
          job_number: job.number,
          job_title: "AC leaking",
          customer_name: "Cara Customer",
          actor_name: "Dan Dispatcher",
          scheduled_start: iso(9),
        },
      }),
    ]);
  });

  it("tells technicians already on a scheduled job when its window moves", async () => {
    const w = world();
    const job = await newJob(w);
    await assign(w, job.id, [w.tom.id], 9, 11);
    // Only the team changes: Rina is assigned, Tom hears nothing new.
    await assign(w, job.id, [w.tom.id, w.rina.id], 9, 11);
    expect(of(w, w.tom.userId).map((n) => n.type)).toEqual(["job_assigned"]);
    expect(of(w, w.rina.userId).map((n) => n.type)).toEqual(["job_assigned"]);
    // The window moves: both are told it was rescheduled.
    await assign(w, job.id, [w.tom.id, w.rina.id], 13, 15);
    expect(of(w, w.tom.userId).map((n) => n.type)).toEqual(["job_assigned", "job_rescheduled"]);
    expect(of(w, w.rina.userId).at(-1)).toMatchObject({
      type: "job_rescheduled",
      payload: { scheduled_start: iso(13) },
    });
  });

  it("doesn't call a first schedule or an unschedule a reschedule", async () => {
    const w = world();
    const job = await newJob(w);
    await assign(w, job.id, [w.tom.id], null, null);
    await assign(w, job.id, [w.tom.id], 9, 11);
    await assign(w, job.id, [w.tom.id], null, null);
    expect(of(w, w.tom.userId).map((n) => n.type)).toEqual(["job_assigned"]);
  });

  it("emails through the context's mailer", async () => {
    const w = world();
    const emails: string[] = [];
    const mailer: NotificationMailer = {
      async send(input) {
        emails.push(`${input.event}:${input.userId}`);
      },
    };
    const job = await newJob(w);
    await jobs.assignJob(w.ctx(w.dispatcher, { mailer }), job.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(9),
      scheduled_end: iso(11),
    });
    expect(emails).toEqual([`job_assigned:${w.tom.userId}`]);
  });
});

describe("expense notifications", () => {
  async function tomsJob(w: World) {
    const job = await newJob(w);
    return assign(w, job.id, [w.tom.id], 9, 11);
  }
  const request = (w: World, jobId: string, unitCost: number) =>
    expenses.requestExpense(w.ctx(w.tom), jobId, {
      kind: "part",
      item: "Compressor",
      quantity: 1,
      unit_cost_minor: unitCost,
      reason: "Seized",
    });

  it("sends pending requests to the people who can approve the amount", async () => {
    const w = world();
    const job = await tomsJob(w);
    const small = await request(w, job.id, 10_000); // below the dispatcher limit of $250
    const large = await request(w, job.id, 40_000);
    await request(w, job.id, 1_000); // auto-approved: nobody needs to act
    const requested = (userId: string) =>
      of(w, userId)
        .filter((n) => n.type === "expense_requested")
        .map((n) => n.payload.expense_id);
    expect(requested(w.owner.userId)).toEqual([small.id, large.id]);
    expect(requested(w.admin.userId)).toEqual([small.id, large.id]);
    expect(requested(w.dispatcher.userId)).toEqual([small.id]);
    expect(requested(w.tom.userId)).toEqual([]);
    expect(of(w, w.owner.userId)[0]!.payload).toMatchObject({
      job_number: job.number,
      item: "Compressor",
      actor_name: "Tom Tech",
    });
  });

  it("tells the requester the decision", async () => {
    const w = world();
    const job = await tomsJob(w);
    const e = await request(w, job.id, 10_000);
    await expenses.decideExpense(w.ctx(w.dispatcher), e.id, { decision: "reject", comment: "Use stock" });
    expect(of(w, w.tom.userId).filter((n) => n.type === "expense_decided")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ decision: "rejected", expense_id: e.id }),
      }),
    ]);
  });

  it("skips decisions without a requester to tell", async () => {
    const w = world();
    const job = await tomsJob(w);
    const e = await request(w, job.id, 10_000);
    const before = sent(w).length;
    const ctx = w.ctx(w.owner);
    await notifications.afterExpenseDecided(ctx, { ...e, status: "approved", requesterMemberId: null });
    await notifications.afterExpenseDecided(ctx, { ...e, status: "pending" });
    await notifications.afterExpenseDecided(ctx, { ...e, status: "approved", requesterMemberId: "gone" });
    expect(sent(w)).toHaveLength(before);
  });
});

describe("notificationHref", () => {
  it("links job events to the job and the rest to a list", () => {
    expect(notifications.notificationHref("sla_breached", { job_number: 42 })).toBe("/jobs/JOB-000042");
    expect(notifications.notificationHref("expense_requested", {})).toBe("/approvals");
    expect(notifications.notificationHref("expense_decided", {})).toBe("/approvals");
    expect(notifications.notificationHref("portal_request", {})).toBe("/notifications");
  });
});

describe("notification center", () => {
  function seeded() {
    const w = world();
    const a = w.data.automate!;
    for (let i = 0; i < 5; i++) {
      a.notifications.push({
        id: `n${i}`,
        userId: w.tom.userId,
        type: "job_assigned",
        payload: { job_number: i },
        readAt: i < 2 ? new Date("2026-11-09T00:00:00Z") : null,
        createdAt: new Date(Date.UTC(2026, 10, 1, i)),
      });
    }
    a.notifications.push({
      id: "other",
      userId: w.rina.userId,
      type: "job_assigned",
      payload: {},
      readAt: null,
      createdAt: new Date(),
    });
    return w;
  }

  it("lists only the user's own notifications, newest first, with cursors and pages", async () => {
    const w = seeded();
    const first = await notifications.listNotifications(w.ctx(w.tom), { limit: "2" });
    expect(first.rows.map((n) => n.id)).toEqual(["n4", "n3"]);
    const second = await notifications.listNotifications(w.ctx(w.tom), {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.rows.map((n) => n.id)).toEqual(["n2", "n1"]);
    const unread = await notifications.listNotifications(w.ctx(w.tom), { unread: "true", page: 1 });
    expect(unread.rows.map((n) => n.id)).toEqual(["n4", "n3", "n2"]);
    expect(unread.total).toBe(3);
    expect((await notifications.listNotifications(w.ctx(w.tom), undefined)).rows).toHaveLength(5);
    expect(await notifications.countUnread(w.ctx(w.tom))).toBe(3);
    expect(await notifications.countUnread(w.ctx(w.rina))).toBe(1);
  });

  it("marks the user's own notifications as read, never someone else's", async () => {
    const w = seeded();
    expect(
      await notifications.markRead(w.ctx(w.tom), { ids: ["00000000-0000-4000-8000-000000000999"] }),
    ).toBe(0);
    w.data.automate!.notifications[4]!.id = "00000000-0000-4000-8000-0000000000a4";
    w.data.automate!.notifications[5]!.id = "00000000-0000-4000-8000-0000000000b5";
    expect(
      await notifications.markRead(w.ctx(w.tom), {
        ids: ["00000000-0000-4000-8000-0000000000a4", "00000000-0000-4000-8000-0000000000b5"],
      }),
    ).toBe(1);
    expect(await notifications.markRead(w.ctx(w.tom), { all: true })).toBe(2);
    expect(await notifications.countUnread(w.ctx(w.tom))).toBe(0);
    expect(await notifications.countUnread(w.ctx(w.rina))).toBe(1);
    await expect(notifications.markRead(w.ctx(w.tom), { ids: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(notifications.markRead(w.ctx(w.tom), {})).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("notification preferences", () => {
  it("lists the events of the user's role with the defaults", async () => {
    const w = world();
    expect(await notifications.getPreferences(w.ctx(w.tom))).toEqual([
      { event: "job_assigned", inApp: true, email: true },
      { event: "job_rescheduled", inApp: true, email: true },
      { event: "expense_decided", inApp: true, email: null },
    ]);
    expect((await notifications.getPreferences(w.ctx(w.dispatcher))).map((p) => p.event)).toEqual([
      "portal_request",
      "sla_at_risk",
      "sla_breached",
      "expense_requested",
      "expense_decided",
    ]);
  });

  it("saves choices, keeps email off for events without email, and rejects other roles' events", async () => {
    const w = world();
    const ctx = w.ctx(w.tom);
    const saved = await notifications.updatePreferences(ctx, {
      preferences: [
        { event: "job_assigned", in_app: true, email: false },
        { event: "expense_decided", in_app: false, email: true },
      ],
    });
    expect(saved).toEqual([
      { event: "job_assigned", inApp: true, email: false },
      { event: "job_rescheduled", inApp: true, email: true },
      { event: "expense_decided", inApp: false, email: null },
    ]);
    // A missing email keeps the current choice.
    await notifications.updatePreferences(ctx, { preferences: [{ event: "job_assigned", in_app: false }] });
    expect((await notifications.getPreferences(ctx))[0]).toEqual({
      event: "job_assigned",
      inApp: false,
      email: false,
    });
    expect(w.data.automate!.notificationPreferences.find((p) => p.event === "expense_decided")?.email).toBe(
      false,
    );
    await expect(
      notifications.updatePreferences(ctx, {
        preferences: [{ event: "sla_breached", in_app: false, email: false }],
      }),
    ).rejects.toThrow("You don't receive this notification");
    await expect(notifications.updatePreferences(ctx, { preferences: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("lets a stored in-app opt-out silence the notification", async () => {
    const w = world();
    const extra = member("technician", "Ana Tech");
    w.data.members.push(extra);
    await notifications.updatePreferences(w.ctx(extra), {
      preferences: [{ event: "job_assigned", in_app: false, email: false }],
    });
    const job = await newJob(w);
    await assign(w, job.id, [extra.id], 9, 11);
    expect(of(w, extra.userId)).toEqual([]);
  });
});
