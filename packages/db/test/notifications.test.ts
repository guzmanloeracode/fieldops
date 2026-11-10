import { jobs, notifications, type Actor, type NotificationRepo, type ServiceContext } from "@fieldops/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Notification center and preferences against PostgreSQL (NOT-01, NOT-03), through RLS as fieldops_app.

let t: TestDb;
let a: OrgData;
let b: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
});
afterAll(async () => t?.close());

const repo = <T>(org: OrgData, fn: (r: NotificationRepo) => Promise<T>) =>
  withStore(t.app, org.orgId, (store) => fn(store.notifications));

function actor(org: OrgData, who: "owner" | "dispatcher" | "tech" | "tech2"): Actor {
  return {
    userId: org.users[who],
    memberId: org.members[who],
    organizationId: org.orgId,
    role: who.startsWith("tech") ? "technician" : (who as "owner" | "dispatcher"),
    name: who,
  };
}
const as = <T>(
  org: OrgData,
  who: "owner" | "dispatcher" | "tech" | "tech2",
  fn: (ctx: ServiceContext) => Promise<T>,
) =>
  withStore(t.app, org.orgId, (store) =>
    fn({ actor: actor(org, who), store, now: new Date("2026-11-11T16:30:00Z"), demo: false }),
  );

describe("notification repository", () => {
  it("lists a user's notifications newest first with cursors, pages and an unread filter", async () => {
    await repo(a, async (r) => {
      for (let i = 0; i < 4; i++) {
        await r.create([{ userId: a.users.tech2, type: "job_assigned", payload: { job_number: i } }]);
      }
    });
    const first = await repo(a, (r) => r.list({ userId: a.users.tech2, limit: 3 }));
    expect(first.rows.map((n) => n.payload.job_number)).toEqual([3, 2, 1]);
    expect(first.total).toBeNull();
    const second = await repo(a, (r) =>
      r.list({ userId: a.users.tech2, limit: 3, cursor: first.nextCursor! }),
    );
    expect(second.rows.map((n) => n.payload.job_number)).toEqual([0]);
    expect(second.nextCursor).toBeNull();
    const paged = await repo(a, (r) => r.list({ userId: a.users.tech2, limit: 3, page: 2 }));
    expect(paged).toMatchObject({ total: 4, nextCursor: null });
    expect(paged.rows).toHaveLength(1);
    expect(await repo(a, (r) => r.unreadCount(a.users.tech2))).toBe(4);
  });

  it("marks only the user's own unread rows as read", async () => {
    const ids = (await repo(a, (r) => r.list({ userId: a.users.tech2, limit: 10 }))).rows.map((n) => n.id);
    const othersId = (await repo(a, (r) => r.list({ userId: a.users.tech, limit: 1 }))).rows[0]!.id;
    const at = new Date("2026-11-11T10:00:00Z");
    expect(await repo(a, (r) => r.markRead(a.users.tech2, [ids[0]!, othersId], at))).toBe(1);
    expect(await repo(a, (r) => r.markRead(a.users.tech2, [], at))).toBe(0);
    expect(await repo(a, (r) => r.unreadCount(a.users.tech2))).toBe(3);
    expect(
      (await repo(a, (r) => r.list({ userId: a.users.tech2, limit: 10, unreadOnly: true }))).rows,
    ).toHaveLength(3);
    expect(await repo(a, (r) => r.markRead(a.users.tech2, "all", at))).toBe(3);
    expect(await repo(a, (r) => r.unreadCount(a.users.tech2))).toBe(0);
    expect(await repo(a, (r) => r.unreadCount(a.users.tech))).toBe(1);
  });

  it("can't reach another organization's notifications", async () => {
    expect(await repo(b, (r) => r.unreadCount(a.users.tech))).toBe(0);
    expect((await repo(b, (r) => r.list({ userId: a.users.tech, limit: 10 }))).rows).toEqual([]);
    expect(await repo(b, (r) => r.markRead(a.users.tech, "all", new Date()))).toBe(0);
    expect(await repo(a, (r) => r.unreadCount(a.users.tech))).toBe(1);
  });

  it("upserts preferences", async () => {
    await repo(a, (r) =>
      r.savePreferences(a.users.dispatcher, [
        { event: "sla_breached", inApp: true, email: false },
        { event: "portal_request", inApp: false, email: true },
      ]),
    );
    await repo(a, (r) =>
      r.savePreferences(a.users.dispatcher, [{ event: "sla_breached", inApp: false, email: true }]),
    );
    await repo(a, (r) => r.savePreferences(a.users.dispatcher, []));
    const all = await repo(a, (r) => r.userPreferences(a.users.dispatcher));
    expect(all.sort((x, y) => x.event.localeCompare(y.event))).toEqual([
      { userId: a.users.dispatcher, event: "portal_request", inApp: false, email: true },
      { userId: a.users.dispatcher, event: "sla_breached", inApp: false, email: true },
    ]);
    expect(await repo(a, (r) => r.preferences([a.users.dispatcher, a.users.owner], "sla_breached"))).toEqual([
      { userId: a.users.dispatcher, event: "sla_breached", inApp: false, email: true },
    ]);
    expect(await repo(a, (r) => r.preferences([], "sla_breached"))).toEqual([]);
    expect(await repo(b, (r) => r.userPreferences(a.users.dispatcher))).toEqual([]);
  });
});

describe("producers through the real services", () => {
  it("notifies a technician assigned to a job, in the same transaction", async () => {
    await as(a, "dispatcher", (ctx) =>
      jobs.assignJob(ctx, a.ids.job, {
        member_ids: [a.members.tech, a.members.tech2],
        scheduled_start: "2026-11-11T15:00:00.000Z",
        scheduled_end: "2026-11-11T17:00:00.000Z",
        override_reason: "Test",
      }),
    );
    const latest = await as(a, "tech2", (ctx) => notifications.listNotifications(ctx, { limit: 1 }));
    expect(latest.rows[0]).toMatchObject({
      type: "job_assigned",
      readAt: null,
      payload: { job_id: a.ids.job, job_number: 1, actor_name: "dispatcher" },
    });
    // Tom was already on the job and the window didn't move: nothing new for him.
    const tom = await t.owner.execute<{ n: number }>(
      sql`select count(*)::int as n from notification where user_id = ${a.users.tech}`,
    );
    expect(tom.rows[0]!.n).toBe(1);
  });
});
