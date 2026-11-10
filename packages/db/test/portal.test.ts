import { audit, portal, type PortalContext, type Store } from "@fieldops/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Customer portal (POR-01–03) and the audit viewer (AUD-03) against PostgreSQL, as the runtime role.

let t: TestDb;
let a: OrgData;
let b: OrgData;
const NOW = new Date("2026-11-10T15:00:00Z");

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
  // A customer-visible note on org A's job, besides the internal one from the helper.
  await t.owner.insert(s.note).values({
    organizationId: a.orgId,
    jobId: a.ids.job,
    body: "We'll bring a new filter",
    visibility: "customer",
    authorUserId: a.users.dispatcher,
  });
});
afterAll(async () => t?.close());

const inA = <T>(fn: Parameters<typeof withStore<T>>[2]) => withStore(t.app, a.orgId, fn);
const inB = <T>(fn: Parameters<typeof withStore<T>>[2]) => withStore(t.app, b.orgId, fn);

describe("portal sign-in", () => {
  it("finds a contact by email only in its own organization", async () => {
    expect(await inA((store) => portal.findPortalContact(store, "C-A@example.com"))).toMatchObject({
      id: a.ids.contact,
      customerId: a.ids.customer,
      customerName: "Customer a",
      name: "Contact",
    });
    expect(await inB((store) => portal.findPortalContact(store, "c-a@example.com"))).toBeNull();
  });

  it("redeems a link once, opens a session and closes it", async () => {
    await inA((store) => portal.issuePortalLink(store, a.ids.contact, "link-hash-1", NOW));
    // Organization B can't use organization A's link.
    const input = {
      linkHash: "link-hash-1",
      sessionHash: "sess-hash-1",
      now: NOW,
      ip: "203.0.113.5",
      userAgent: "UA",
    };
    expect(await inB((store) => portal.redeemPortalLink(store, input))).toBeNull();
    const redeemed = await inA((store) => portal.redeemPortalLink(store, input));
    expect(redeemed?.contact.id).toBe(a.ids.contact);
    expect(await inA((store) => portal.redeemPortalLink(store, { ...input, sessionHash: "x" }))).toBeNull();

    const actor = await inA((store) => portal.resolvePortalSession(store, "sess-hash-1", NOW));
    expect(actor).toEqual({
      organizationId: a.orgId,
      customerId: a.ids.customer,
      customerName: "Customer a",
      contactId: a.ids.contact,
      contactName: "Contact",
    });
    expect(await inB((store) => portal.resolvePortalSession(store, "sess-hash-1", NOW))).toBeNull();
    const [row] = await t.owner
      .execute<{ last_seen_at: Date; ip: string }>(
        sql`select last_seen_at, ip from portal_session where token_hash = 'sess-hash-1'`,
      )
      .then((r) => r.rows);
    expect(row).toMatchObject({ ip: "203.0.113.5" });
    expect(new Date(row!.last_seen_at)).toEqual(NOW);

    await inA((store) => portal.closePortalSession(store, "sess-hash-1"));
    expect(await inA((store) => portal.resolvePortalSession(store, "sess-hash-1", NOW))).toBeNull();
  });

  it("refuses expired links and sessions of deleted customers", async () => {
    await inA((store) =>
      portal.issuePortalLink(store, a.ids.contact, "link-old", new Date("2026-11-01T00:00:00Z")),
    );
    expect(
      await inA((store) =>
        portal.redeemPortalLink(store, {
          linkHash: "link-old",
          sessionHash: "s-old",
          now: NOW,
          ip: null,
          userAgent: null,
        }),
      ),
    ).toBeNull();
    // The helper's session row belongs to a live customer; a soft-deleted customer ends it.
    expect(await inB((store) => portal.resolvePortalSession(store, "session-b", NOW))).not.toBeNull();
    await t.owner.execute(sql`update customer set deleted_at = now() where id = ${b.ids.customer}`);
    expect(await inB((store) => portal.resolvePortalSession(store, "session-b", NOW))).toBeNull();
    await t.owner.execute(sql`update customer set deleted_at = null where id = ${b.ids.customer}`);
  });
});

describe("portal tracking and requests", () => {
  const ctxFor = (store: PortalContext["store"], org: OrgData): PortalContext => ({
    portal: {
      organizationId: org.orgId,
      customerId: org.ids.customer,
      customerName: `Customer ${org === a ? "a" : "b"}`,
      contactId: org.ids.contact,
      contactName: "Contact",
    },
    store,
    now: NOW,
    demo: false,
  });

  it("shows only the customer's jobs, with the technician's first name and customer-facing events", async () => {
    const jobs = await inA((store) => portal.listPortalJobs(ctxFor(store, a)));
    expect(jobs.map((j) => [j.id, j.technicianFirstName, j.site.label])).toEqual([[a.ids.job, "a", "Home"]]);
    const detail = await inA((store) => portal.getPortalJob(ctxFor(store, a), 1));
    expect(detail.notes.map((n) => n.body)).toEqual(["We'll bring a new filter"]);
    expect(detail.steps.map((x) => x.status)).toEqual(["new"]);
    // Organization B's portal customer can't open organization A's job number 1: it sees its own job 1.
    const other = await inB((store) => portal.getPortalJob(ctxFor(store, b), 1));
    expect(other.job.id).toBe(b.ids.job);
    // A customer of the same organization without that job gets nothing.
    await t.owner
      .insert(s.customer)
      .values({ id: crypto.randomUUID(), organizationId: a.orgId, name: "Stranger" });
    const stranger = await t.owner.execute<{ id: string }>(
      sql`select id from customer where name = 'Stranger'`,
    );
    const ctx = (store: PortalContext["store"]) => ({
      ...ctxFor(store, a),
      portal: { ...ctxFor(store, a).portal, customerId: stranger.rows[0]!.id },
    });
    expect(await inA((store) => portal.listPortalJobs(ctx(store)))).toEqual([]);
    await expect(inA((store) => portal.getPortalJob(ctx(store), 1))).rejects.toThrow("Job not found");
  });

  it("creates a job from a request in the same transaction as its event, notification and audit row", async () => {
    const created = await withStore(
      t.app,
      a.orgId,
      (store) =>
        portal.createPortalRequest(ctxFor(store, a), {
          description: "Water dripping from the indoor unit\nSince this morning",
          site_id: a.ids.site,
          windows: [{ date: "2026-11-12", slot: "morning" }],
        }),
      { userId: null, ip: "198.51.100.20", userAgent: "Portal UA" },
    );
    const [job] = await t.owner
      .execute<Record<string, unknown>>(
        sql`select title, status, source, needs_review, ai_status, created_by, preferred_start from job where id = ${created.id}`,
      )
      .then((r) => r.rows);
    expect(job).toMatchObject({
      title: "Water dripping from the indoor unit",
      status: "new",
      source: "portal",
      needs_review: true,
      ai_status: "pending",
      created_by: null,
    });
    // America/Chicago: 8 AM on Nov 12 is 14:00 UTC.
    expect(new Date(job!.preferred_start as string).toISOString()).toBe("2026-11-12T14:00:00.000Z");
    const notes = await t.owner.execute<{ user_id: string; type: string }>(
      sql`select user_id, type from notification where organization_id = ${a.orgId} and type = 'portal_request'`,
    );
    expect(notes.rows).toEqual([{ user_id: a.users.dispatcher, type: "portal_request" }]);
    const auditRows = await t.owner.execute<{ actor_user_id: string | null; ip: string; action: string }>(
      sql`select actor_user_id, ip, action from audit_log where entity_id = ${created.id}`,
    );
    expect(auditRows.rows).toEqual([{ actor_user_id: null, ip: "198.51.100.20", action: "job.insert" }]);
  });
});

describe("audit log viewer", () => {
  it("lists newest first with filters, job links, actor names and keyset pages", async () => {
    await withStore(
      t.app,
      a.orgId,
      async (store, tx) => {
        await tx.execute(sql`update job set title = 'Audited title' where id = ${a.ids.job}`);
        await tx.execute(sql`update job_assignment set is_lead = false where id = ${a.ids.assignment}`);
        await audit.recordAuthEvent(store, "sign_in", a.users.dispatcher);
      },
      { userId: a.users.dispatcher, ip: "192.0.2.10", userAgent: "Chrome" },
    );
    const list = (f: Partial<Parameters<Store["audit"]["list"]>[0]> = {}) =>
      inA((store) => store.audit.list({ limit: 50, ...f }));
    const mine = await list({ actor: a.users.dispatcher });
    expect(mine.map((e) => e.action)).toEqual(["auth.sign_in", "job_assignment.update", "job.update"]);
    expect(mine.every((e) => e.actorName === "a dispatcher" && e.ip === "192.0.2.10")).toBe(true);
    expect(mine[1]!.job).toEqual({ id: a.ids.job, number: 1 });
    expect(mine[2]!.job).toEqual({ id: a.ids.job, number: 1 });
    expect(mine[0]!.job).toBeNull();

    expect((await list({ operation: "sign_in" })).map((e) => e.entityId)).toEqual([a.users.dispatcher]);
    expect((await list({ entityType: "customer", actor: "system" })).length).toBeGreaterThan(0);
    expect(await list({ entityId: a.ids.job, actor: a.users.dispatcher })).toHaveLength(1);
    expect(await list({ from: new Date(Date.now() + 3600_000) })).toEqual([]);
    expect((await list({ to: new Date(0) })).length).toBe(0);

    const first = await list({ limit: 2 });
    const next = await list({ limit: 2, before: { createdAt: first[1]!.createdAt, id: first[1]!.id } });
    expect(next.map((e) => e.id)).not.toContain(first[0]!.id);
    expect(next.map((e) => e.id)).not.toContain(first[1]!.id);

    expect(await inA((store) => store.audit.actors())).toEqual([
      { userId: a.users.dispatcher, name: "a dispatcher" },
    ]);
    // Organization B sees none of it.
    expect(await inB((store) => store.audit.list({ actor: a.users.dispatcher, limit: 10 }))).toEqual([]);
  });
});
