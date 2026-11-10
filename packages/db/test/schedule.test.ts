import type { Store } from "@fieldops/core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Scheduling and availability repositories (SCH-01–05) against PostgreSQL, through the RLS-bound role.

let t: TestDb;
let a: OrgData;
let b: OrgData;
const runA = <T>(fn: (store: Store) => Promise<T>) => withStore(t.app, a.orgId, fn);
const runB = <T>(fn: (store: Store) => Promise<T>) => withStore(t.app, b.orgId, fn);
const d = (iso: string) => new Date(iso);

async function addJob(org: OrgData, values: Partial<typeof s.job.$inferInsert> & { number: number }) {
  const id = randomUUID();
  await t.owner.insert(s.job).values({
    id,
    organizationId: org.orgId,
    customerId: org.ids.customer,
    siteId: org.ids.site,
    title: `Job ${values.number}`,
    ...values,
  });
  return id;
}

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a"); // job #1: 2026-11-11 15:00–17:00Z, tech (lead)
  b = await createOrgWithData(t.owner, "b");
});
afterAll(async () => t?.close());

describe("scheduleRepo", () => {
  it("lists visits overlapping a range, with assignees, in start order", async () => {
    const early = await addJob(a, {
      number: 2,
      status: "completed",
      scheduledStart: d("2026-11-11T13:00:00Z"),
      scheduledEnd: d("2026-11-11T14:00:00Z"),
    });
    await t.owner
      .insert(s.jobAssignment)
      .values({ organizationId: a.orgId, jobId: early, memberId: a.members.tech2, isLead: true });
    await addJob(a, {
      number: 3,
      status: "canceled",
      scheduledStart: d("2026-11-11T13:00:00Z"),
      scheduledEnd: d("2026-11-11T14:00:00Z"),
    });
    await addJob(a, {
      number: 4,
      status: "scheduled",
      scheduledStart: d("2026-11-12T13:00:00Z"),
      scheduledEnd: d("2026-11-12T14:00:00Z"),
      deletedAt: d("2026-11-10T00:00:00Z"),
    });
    const day = { from: d("2026-11-11T06:00:00Z"), to: d("2026-11-12T06:00:00Z") };
    const all = await runA((st) => st.schedule.scheduled(day));
    expect(all.map((j) => j.number)).toEqual([2, 1]);
    expect(all[1]!.assignees).toEqual([
      expect.objectContaining({ memberId: a.members.tech, name: "a tech", isLead: true }),
    ]);
    expect(all[1]!.site.label).toBe("Home");
    const tech2 = await runA((st) => st.schedule.scheduled({ ...day, memberId: a.members.tech2 }));
    expect(tech2.map((j) => j.number)).toEqual([2]);
    // The range end is exclusive and organization B sees nothing of A's.
    expect(
      await runA((st) =>
        st.schedule.scheduled({ from: d("2026-11-11T17:00:00Z"), to: d("2026-11-11T18:00:00Z") }),
      ),
    ).toEqual([]);
    expect((await runB((st) => st.schedule.scheduled(day))).map((j) => j.title)).toEqual(["Job b"]);
  });

  it("orders the unscheduled queue by urgency, then age", async () => {
    const created = (h: number) => d(`2026-11-0${h}T10:00:00Z`);
    await addJob(a, { number: 10, status: "new", priority: "low", createdAt: created(1) });
    await addJob(a, { number: 11, status: "new", priority: "urgent", createdAt: created(3) });
    await addJob(a, { number: 12, status: "new", priority: "urgent", createdAt: created(2) });
    await addJob(a, { number: 13, status: "new", priority: "high", createdAt: created(4) });
    await addJob(a, { number: 14, status: "new", priority: "normal", createdAt: created(5) });
    // Not in the queue: scheduled, or new with a window already set.
    await addJob(a, { number: 15, status: "scheduled", priority: "urgent", createdAt: created(1) });
    await addJob(a, {
      number: 16,
      status: "new",
      priority: "urgent",
      scheduledStart: d("2026-11-20T10:00:00Z"),
      scheduledEnd: d("2026-11-20T11:00:00Z"),
    });
    expect((await runA((st) => st.schedule.unscheduled(50))).map((j) => j.number)).toEqual([
      12, 11, 13, 14, 10,
    ]);
    expect((await runA((st) => st.schedule.unscheduled(2))).map((j) => j.number)).toEqual([12, 11]);
    expect(await runB((st) => st.schedule.unscheduled(50))).toEqual([]);
  });
});

describe("availabilityRepo", () => {
  it("updates a member's hours and skills within the organization only", async () => {
    const hours = [{ day: 1, open: "08:00", close: "17:00" }];
    expect(
      await runA((st) =>
        st.availability.updateMember(a.members.tech, { workingHours: hours, skills: ["ac"] }),
      ),
    ).toBe(true);
    let tech = await runA((st) => st.members.get(a.members.tech));
    expect(tech).toMatchObject({ workingHours: hours, skills: ["ac"] });
    expect(await runA((st) => st.availability.updateMember(a.members.tech, { workingHours: null }))).toBe(
      true,
    );
    tech = await runA((st) => st.members.get(a.members.tech));
    expect(tech).toMatchObject({ workingHours: null, skills: ["ac"] });
    expect(await runA((st) => st.availability.updateMember(a.members.tech, {}))).toBe(true);
    expect(await runA((st) => st.availability.updateMember(randomUUID(), {}))).toBe(false);
    // Another organization's member can't be changed, with or without RLS.
    expect(await runB((st) => st.availability.updateMember(a.members.tech, { skills: ["hacked"] }))).toBe(
      false,
    );
    expect(await runB((st) => st.availability.updateMember(a.members.tech, {}))).toBe(false);
    expect((await runA((st) => st.members.get(a.members.tech)))!.skills).toEqual(["ac"]);
  });

  it("creates, finds, lists and removes time off", async () => {
    // The helper already gave tech a vacation on 20 Nov.
    const created = await runA((st) =>
      st.availability.createTimeOff({
        memberId: a.members.tech2,
        startsAt: d("2026-11-19T00:00:00Z"),
        endsAt: d("2026-11-20T12:00:00Z"),
        reason: null,
        createdBy: a.users.dispatcher,
      }),
    );
    expect(created).toMatchObject({ memberId: a.members.tech2, reason: null });
    const week = { from: d("2026-11-16T00:00:00Z"), to: d("2026-11-23T00:00:00Z") };
    const all = await runA((st) => st.availability.listTimeOff(week));
    expect(all.map((x) => [x.memberId, x.reason])).toEqual([
      [a.members.tech2, null],
      [a.members.tech, "Vacation"],
    ]);
    expect(
      (await runA((st) => st.availability.listTimeOff({ ...week, memberIds: [a.members.tech] }))).map(
        (x) => x.reason,
      ),
    ).toEqual(["Vacation"]);
    expect(await runA((st) => st.availability.listTimeOff({ ...week, memberIds: [] }))).toEqual([]);
    expect(
      await runA((st) =>
        st.availability.listTimeOff({ from: d("2026-11-21T00:00:00Z"), to: d("2026-11-22T00:00:00Z") }),
      ),
    ).toEqual([]);
    expect(await runA((st) => st.availability.getTimeOff(created.id))).toEqual(created);
    expect(await runB((st) => st.availability.getTimeOff(created.id))).toBeNull();
    expect(await runB((st) => st.availability.removeTimeOff(created.id))).toBe(false);
    expect(await runA((st) => st.availability.removeTimeOff(created.id))).toBe(true);
    expect(await runA((st) => st.availability.removeTimeOff(created.id))).toBe(false);
    expect(await runA((st) => st.availability.getTimeOff(created.id))).toBeNull();
  });
});
