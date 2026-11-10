import { describe, expect, it } from "vitest";
import { world } from "../test/fixtures";
import type { NotificationMailer } from "./notification-types";
import { notify, usersWithRoles } from "./notify";

function recordingMailer() {
  const sent: Parameters<NotificationMailer["send"]>[0][] = [];
  const mailer: NotificationMailer = {
    async send(input) {
      sent.push(input);
    },
  };
  return { mailer, sent };
}

describe("notify", () => {
  it("creates one in-app notification per recipient, skipping the actor and duplicates", async () => {
    const w = world();
    const { mailer, sent } = recordingMailer();
    const n = await notify(
      { store: w.store, mailer },
      {
        event: "job_assigned",
        userIds: [w.tom.userId, w.tom.userId, w.rina.userId, w.dispatcher.userId],
        payload: { job_number: 7 },
        exceptUserId: w.dispatcher.userId,
      },
    );
    expect(n).toBe(2);
    expect(w.data.automate!.notifications.map((x) => [x.userId, x.type, x.payload.job_number])).toEqual([
      [w.tom.userId, "job_assigned", 7],
      [w.rina.userId, "job_assigned", 7],
    ]);
    expect(sent.map((s) => s.userId)).toEqual([w.tom.userId, w.rina.userId]);
  });

  it("follows each user's channel preferences", async () => {
    const w = world();
    const { mailer, sent } = recordingMailer();
    await notify({ store: w.store }, { event: "sla_breached", userIds: [], payload: {} });
    w.data.automate!.notificationPreferences.push(
      { userId: w.tom.userId, event: "job_assigned", inApp: false, email: true },
      { userId: w.rina.userId, event: "job_assigned", inApp: true, email: false },
      { userId: w.rina.userId, event: "sla_breached", inApp: false, email: false },
    );
    await notify(
      { store: w.store, mailer },
      { event: "job_assigned", userIds: [w.tom.userId, w.rina.userId], payload: {} },
    );
    expect(w.data.automate!.notifications.map((x) => x.userId)).toEqual([w.rina.userId]);
    expect(sent.map((s) => s.userId)).toEqual([w.tom.userId]);
  });

  it("never emails events without an email channel, and skips email without a mailer", async () => {
    const w = world();
    const { mailer, sent } = recordingMailer();
    await notify(
      { store: w.store, mailer },
      { event: "expense_requested", userIds: [w.owner.userId], payload: { item: "Pump" } },
    );
    await notify({ store: w.store }, { event: "portal_request", userIds: [w.owner.userId], payload: {} });
    expect(sent).toEqual([]);
    expect(w.data.automate!.notifications).toHaveLength(2);
  });

  it("returns 0 when nobody is left to notify", async () => {
    const w = world();
    expect(
      await notify(
        { store: w.store },
        { event: "job_assigned", userIds: [w.tom.userId], payload: {}, exceptUserId: w.tom.userId },
      ),
    ).toBe(0);
    w.data.automate!.notificationPreferences.push({
      userId: w.tom.userId,
      event: "job_rescheduled",
      inApp: false,
      email: false,
    });
    expect(
      await notify({ store: w.store }, { event: "job_rescheduled", userIds: [w.tom.userId], payload: {} }),
    ).toBe(0);
    expect(w.data.automate!.notifications).toEqual([]);
  });
});

describe("usersWithRoles", () => {
  it("lists the user ids of members with the given roles", async () => {
    const w = world();
    expect(await usersWithRoles(w.store, ["dispatcher"])).toEqual([w.dispatcher.userId]);
    expect(await usersWithRoles(w.store, ["owner", "admin"])).toEqual([w.owner.userId, w.admin.userId]);
  });
});
