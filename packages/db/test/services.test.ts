import { customers, jobs, NotFoundError, type Actor, type ServiceContext, type Store } from "@fieldops/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// One request-to-completion path through the real services, repositories and row-level security.

let t: TestDb;
let o: OrgData;
let other: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  o = await createOrgWithData(t.owner, "svc");
  other = await createOrgWithData(t.owner, "other");
});
afterAll(async () => t?.close());

function actor(org: OrgData, who: "owner" | "dispatcher" | "tech"): Actor {
  return {
    userId: org.users[who],
    memberId: org.members[who],
    organizationId: org.orgId,
    role: who === "tech" ? "technician" : who,
    name: `${who}`,
  };
}
const as = <T>(org: OrgData, who: "owner" | "dispatcher" | "tech", fn: (ctx: ServiceContext) => Promise<T>) =>
  withStore(t.app, org.orgId, (store: Store) => fn({ actor: actor(org, who), store, now: new Date("2026-11-11T16:30:00Z"), demo: false }));

describe("request to completed job", () => {
  it("runs end to end", async () => {
    const created = await as(o, "dispatcher", (ctx) =>
      customers.createCustomer(ctx, {
        name: "Cara Customer",
        contacts: [{ name: "Cara", email: "Cara@Example.com", phone: "(512) 555-0177" }],
      }),
    );
    expect(created.duplicates).toEqual([]);
    const again = await as(o, "dispatcher", (ctx) => customers.createCustomer(ctx, { name: "Cara 2", contacts: [{ name: "C", phone: "512-555-0177" }] }));
    expect(again.duplicates).toEqual([{ id: created.customer.id, name: "Cara Customer", matchedOn: "phone" }]);

    const site = await as(o, "dispatcher", (ctx) =>
      customers.createSite(ctx, created.customer.id, {
        label: "Home",
        address: { line1: "9 Oak St", city: "Austin", region: "TX", postal_code: "78702", country: "us" },
      }),
    );
    const job = await as(o, "dispatcher", (ctx) =>
      jobs.createJob(ctx, {
        customer_id: created.customer.id,
        site_id: site.id,
        service_type_id: o.ids.serviceType,
        title: "Bedroom AC leaking",
        priority: "high",
      }),
    );
    expect(job).toMatchObject({ number: 2, status: "new", estimatedDurationMin: 60, customer: { name: "Cara Customer" } });

    const scheduled = await as(o, "dispatcher", (ctx) =>
      jobs.assignJob(ctx, job.id, { member_ids: [o.members.tech2], scheduled_start: "2026-11-12T15:00:00Z", scheduled_end: "2026-11-12T16:30:00Z" }),
    );
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.assignees.map((a) => a.memberId)).toEqual([o.members.tech2]);

    // tech (not assigned) can't see it; reassign to tech, who already has a visit 15:00–17:00 on Nov 11.
    await expect(as(o, "tech", (ctx) => jobs.getJob(ctx, job.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(o, "dispatcher", (ctx) => jobs.assignJob(ctx, job.id, { member_ids: [o.members.tech], scheduled_start: "2026-11-11T16:00:00Z", scheduled_end: "2026-11-11T17:30:00Z" })),
    ).rejects.toMatchObject({ code: "conflict" });
    await as(o, "dispatcher", (ctx) =>
      jobs.assignJob(ctx, job.id, { member_ids: [o.members.tech], scheduled_start: "2026-11-11T17:00:00Z", scheduled_end: "2026-11-11T18:30:00Z" }),
    );

    await as(o, "tech", (ctx) => jobs.transitionJob(ctx, job.id, { to: "en_route" }));
    await as(o, "tech", (ctx) => jobs.transitionJob(ctx, job.id, { to: "in_progress" }));
    await as(o, "tech", (ctx) => jobs.addNote(ctx, job.id, { body: "Drain line flushed", visibility: "customer" }));
    const done = await as(o, "tech", (ctx) => jobs.transitionJob(ctx, `JOB-${String(job.number).padStart(6, "0")}`, { to: "completed" }));
    expect(done).toMatchObject({ status: "completed", completedAt: new Date("2026-11-11T16:30:00Z") });

    const events = await as(o, "owner", (ctx) => jobs.listJobEvents(ctx, job.id));
    expect(events.map((e) => e.type).reverse()).toEqual([
      "created",
      "assigned",
      "assigned",
      "status_changed",
      "status_changed",
      "note_added",
      "status_changed",
    ]);
    expect((await as(o, "owner", (ctx) => jobs.listNotes(ctx, job.id)))[0]).toMatchObject({ body: "Drain line flushed", author: { name: "svc tech" } });
    expect((await as(o, "tech", (ctx) => customers.getCustomer(ctx, created.customer.id))).name).toBe("Cara Customer");

    // The other organization sees none of it.
    await expect(as(other, "owner", (ctx) => jobs.getJob(ctx, job.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(other, "owner", (ctx) => customers.getCustomer(ctx, created.customer.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(other, "dispatcher", (ctx) => jobs.createJob(ctx, { customer_id: created.customer.id, site_id: site.id, title: "x" })),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("rolls the whole transaction back when a service fails", async () => {
    await expect(
      as(o, "dispatcher", async (ctx) => {
        await customers.createCustomer(ctx, { name: "Rolled back" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const found = await as(o, "dispatcher", (ctx) => customers.listCustomers(ctx, { sort: "name", limit: 50, q: "Rolled back" }));
    expect(found.rows).toEqual([]);
  });
});
