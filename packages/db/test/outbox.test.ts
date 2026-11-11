import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { quiet, withTenant } from "../src/client";
import { RelayError, type EventRelay } from "@fieldops/core";
import { createRelayClient, startFakeRelay } from "@fieldops/relay";
import {
  claimOutboxEvents,
  deleteOldOutboxEvents,
  markOutboxFailed,
  markOutboxSent,
  organizationsWithWebhooks,
  OUTBOX_MAX_ATTEMPTS,
  outboxBackoffSeconds,
  publishOutbox,
  type OutboxFailure,
} from "../src/outbox";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, pgErrorOf, type OrgData, type TestDb } from "./helpers";

// The integration-event outbox (PLT-03, ADR 022): the 0005 triggers write one thin event per change, only for
// organizations with webhooks on and never for quiet (seed and reset) transactions; the worker's queue functions.

let t: TestDb;
let a: OrgData;
let b: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "hooks");
  b = await createOrgWithData(t.owner, "quiet");
  await t.owner
    .update(s.organization)
    .set({ webhooksEnabledAt: new Date() })
    .where(eq(s.organization.id, a.orgId));
});
afterAll(async () => t?.close());
beforeEach(async () => {
  await t.owner.delete(s.outboxEvent);
});

/** Runs as the web app does: the app role, inside the organization's transaction. */
const asApp = <T>(org: OrgData, fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) =>
  withTenant(t.app, org.orgId, fn, { userId: org.users.owner });

async function events(org = a) {
  const rows = await t.owner
    .select({ type: s.outboxEvent.type, payload: s.outboxEvent.payload })
    .from(s.outboxEvent)
    .where(eq(s.outboxEvent.organizationId, org.orgId))
    .orderBy(s.outboxEvent.id);
  return rows as { type: string; payload: Record<string, any> }[];
}

const job = (org: OrgData) => and(eq(s.job.organizationId, org.orgId), eq(s.job.id, org.ids.job));

describe("job events", () => {
  it("writes job.created with a thin payload", async () => {
    const id = crypto.randomUUID();
    await asApp(a, (tx) =>
      tx.insert(s.job).values({
        id,
        organizationId: a.orgId,
        number: 42,
        customerId: a.ids.customer,
        siteId: a.ids.site,
        title: "No cooling",
        scheduledStart: new Date("2026-11-12T09:00:00Z"),
      }),
    );
    const [e] = await events();
    expect(e?.type).toBe("job.created");
    expect(e?.payload.job).toMatchObject({
      id,
      number: "JOB-000042",
      title: "No cooling",
      status: "new",
      customer_id: a.ids.customer,
      scheduled_start: "2026-11-12T09:00:00.000Z",
      scheduled_end: null,
    });
  });

  it("writes status_changed, plus completed when the job is done", async () => {
    await asApp(a, (tx) => tx.update(s.job).set({ status: "in_progress" }).where(job(a)));
    await asApp(a, (tx) =>
      tx.update(s.job).set({ status: "completed", completedAt: new Date() }).where(job(a)),
    );
    const got = await events();
    expect(got.map((e) => e.type)).toEqual(["job.status_changed", "job.status_changed", "job.completed"]);
    expect(got[0]?.payload).toMatchObject({ previous_status: "scheduled", job: { status: "in_progress" } });
    expect(got[2]?.payload.job.completed_at).toMatch(/Z$/);
    await asApp(a, (tx) => tx.update(s.job).set({ status: "scheduled", completedAt: null }).where(job(a)));
  });

  it("writes job.updated for fields people change, naming them, and nothing for bookkeeping", async () => {
    await asApp(a, (tx) => tx.update(s.job).set({ title: "Renamed", priority: "high" }).where(job(a)));
    await asApp(a, (tx) =>
      tx.update(s.job).set({ slaResponseState: "at_risk", aiStatus: "skipped", version: 9 }).where(job(a)),
    );
    const got = await events();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "job.updated", payload: { changed: ["title", "priority"] } });
  });

  it("is silent for deleted jobs", async () => {
    const id = crypto.randomUUID();
    await t.owner.insert(s.job).values({
      id,
      organizationId: a.orgId,
      number: 43,
      customerId: a.ids.customer,
      siteId: a.ids.site,
      title: "Gone",
      deletedAt: new Date(),
    });
    await t.owner.update(s.job).set({ title: "Still gone" }).where(eq(s.job.id, id));
    expect(await events()).toEqual([]);
  });

  it("writes one job.assigned per job when the team is replaced", async () => {
    await withStore(t.app, a.orgId, (store) =>
      store.jobs.setAssignments(a.ids.job, [
        { memberId: a.members.tech, isLead: false },
        { memberId: a.members.tech2, isLead: true },
      ]),
    );
    const got = await events();
    expect(got.map((e) => e.type)).toEqual(["job.assigned"]);
    expect(got[0]?.payload.assignees).toEqual([
      { member_id: a.members.tech2, is_lead: true },
      { member_id: a.members.tech, is_lead: false },
    ]);
    // Clearing every assignment inserts nothing.
    await withStore(t.app, a.orgId, (store) => store.jobs.setAssignments(a.ids.job, []));
    expect(await events()).toHaveLength(1);
    await withStore(t.app, a.orgId, (store) =>
      store.jobs.setAssignments(a.ids.job, [{ memberId: a.members.tech, isLead: true }]),
    );
  });

  it("writes SLA events once per alert", async () => {
    await t.owner
      .update(s.job)
      .set({ resolutionDueAt: new Date("2026-11-12T00:00:00Z") })
      .where(eq(s.job.id, a.ids.job));
    await t.owner.delete(s.outboxEvent);
    await t.owner.execute(sql`
      insert into sla_alert (organization_id, job_id, target, kind) values (${a.orgId}, ${a.ids.job}, 'resolution', 'breached')
      on conflict do nothing`);
    await t.owner.execute(sql`
      insert into sla_alert (organization_id, job_id, target, kind) values (${a.orgId}, ${a.ids.job}, 'resolution', 'breached')
      on conflict do nothing`);
    const got = await events();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      type: "sla.breached",
      payload: { clock: "resolution", due_at: "2026-11-12T00:00:00.000Z", job: { id: a.ids.job } },
    });
  });
});

describe("billing and expense events", () => {
  it("writes quote.sent, quote.approved and quote.declined on status changes", async () => {
    const [q] = await t.owner.select().from(s.quote).where(eq(s.quote.organizationId, a.orgId));
    await asApp(a, (tx) => tx.update(s.quote).set({ status: "sent" }).where(eq(s.quote.id, q!.id)));
    await asApp(a, (tx) => tx.update(s.quote).set({ title: "Same status" }).where(eq(s.quote.id, q!.id)));
    await asApp(a, (tx) => tx.update(s.quote).set({ status: "approved" }).where(eq(s.quote.id, q!.id)));
    await t.owner.insert(s.quote).values({
      organizationId: a.orgId,
      number: "QUO-2026-0002",
      customerId: a.ids.customer,
      title: "Declined at once",
      status: "declined",
      declineReason: "Too expensive",
      currency: "USD",
    });
    const got = await events();
    expect(got.map((e) => e.type)).toEqual(["quote.sent", "quote.approved", "quote.declined"]);
    expect(got[0]?.payload.quote).toMatchObject({ number: "QUO-2026-0001", status: "sent", currency: "USD" });
    expect(got[2]?.payload.quote).toMatchObject({ decline_reason: "Too expensive" });
  });

  it("writes invoice.sent when issued and invoice.paid when paid, even from overdue", async () => {
    const [inv] = await t.owner.select().from(s.invoice).where(eq(s.invoice.organizationId, a.orgId));
    const set = (status: string, extra: Partial<typeof s.invoice.$inferInsert> = {}) =>
      asApp(a, (tx) =>
        tx
          .update(s.invoice)
          .set({ status, ...extra })
          .where(eq(s.invoice.id, inv!.id)),
      );
    await set("draft");
    await set("sent");
    await set("overdue");
    await set("sent"); // back from overdue: not a new send
    await set("overdue");
    await set("paid", { paidAt: new Date("2026-11-11T10:00:00Z"), amountPaidMinor: 2500 });
    const got = await events();
    expect(got.map((e) => e.type)).toEqual(["invoice.sent", "invoice.paid"]);
    expect(got[1]?.payload.invoice).toMatchObject({
      status: "paid",
      amount_paid_minor: 2500,
      paid_at: "2026-11-11T10:00:00.000Z",
    });
  });

  it("writes expense.decided when a request is decided or approved on submission", async () => {
    const [ex] = await t.owner
      .select()
      .from(s.expenseRequest)
      .where(eq(s.expenseRequest.organizationId, a.orgId));
    await asApp(a, (tx) =>
      tx
        .update(s.expenseRequest)
        .set({ status: "rejected", decidedAt: new Date() })
        .where(eq(s.expenseRequest.id, ex!.id)),
    );
    await t.owner.insert(s.expenseRequest).values({
      organizationId: a.orgId,
      jobId: a.ids.job,
      item: "Filter",
      quantity: 1,
      unitCostMinor: 900,
      totalMinor: 900,
      currency: "USD",
      reason: "Clogged",
      status: "approved",
      autoApproved: true,
    });
    await t.owner.insert(s.expenseRequest).values({
      organizationId: a.orgId,
      jobId: a.ids.job,
      item: "Pending",
      quantity: 1,
      unitCostMinor: 900,
      totalMinor: 900,
      currency: "USD",
      reason: "Waiting",
    });
    const got = await events();
    expect(got.map((e) => e.type)).toEqual(["expense.decided", "expense.decided"]);
    expect(got.map((e) => e.payload.expense.status)).toEqual(["rejected", "approved"]);
    expect(got[1]?.payload.expense.auto_approved).toBe(true);
  });
});

describe("when there are no events", () => {
  it("writes nothing for an organization with webhooks off", async () => {
    await asApp(b, (tx) => tx.update(s.job).set({ status: "in_progress" }).where(job(b)));
    expect(await events(b)).toEqual([]);
  });

  it("writes nothing in quiet transactions (seed, reset)", async () => {
    await withTenant(t.owner, a.orgId, async (tx) => {
      await quiet(tx);
      await tx.update(s.job).set({ title: "Seeded" }).where(job(a));
    });
    expect(await events()).toEqual([]);
  });
});

describe("outbox access", () => {
  it("lets the app read its own events but never write them", async () => {
    await asApp(a, (tx) => tx.update(s.job).set({ title: "Visible" }).where(job(a)));
    const own = await asApp(a, (tx) => tx.select().from(s.outboxEvent));
    expect(own.length).toBe(1);
    expect(await asApp(b, (tx) => tx.select().from(s.outboxEvent))).toEqual([]);
    const err = await pgErrorOf(
      asApp(a, (tx) =>
        tx.insert(s.outboxEvent).values({ organizationId: a.orgId, type: "job.created", payload: {} }),
      ),
    );
    expect(err).toMatch(/42501|permission denied/);
  });

  it("names Relay events through the repository", async () => {
    await asApp(a, (tx) => tx.update(s.job).set({ title: "Named" }).where(job(a)));
    const [row] = await t.owner.select().from(s.outboxEvent);
    await markOutboxSent(t.owner, row!.id, "evt_named");
    const types = await withStore(t.app, a.orgId, (store) =>
      store.webhooks.eventTypes(["evt_named", "evt_x"]),
    );
    expect(types).toEqual({ evt_named: "job.updated" });
    expect(await withStore(t.app, a.orgId, (store) => store.webhooks.eventTypes([]))).toEqual({});
    expect(await withStore(t.app, b.orgId, (store) => store.webhooks.eventTypes(["evt_named"]))).toEqual({});
  });

  it("turns webhooks on and off through the repository", async () => {
    const at = new Date("2026-11-11T08:00:00Z");
    await withStore(t.app, b.orgId, (store) => store.webhooks.setEnabled(at));
    expect(await withStore(t.app, b.orgId, (store) => store.webhooks.state())).toEqual({
      enabledAt: at,
      name: "Org quiet",
    });
    expect((await organizationsWithWebhooks(t.owner)).sort()).toEqual([a.orgId, b.orgId].sort());
    await withStore(t.app, b.orgId, (store) => store.webhooks.setEnabled(null));
    expect(await organizationsWithWebhooks(t.owner)).toEqual([a.orgId]);
  });
});

describe("the worker's queue", () => {
  it("claims due events once, backs off failures and gives up after the last attempt", async () => {
    await asApp(a, (tx) => tx.update(s.job).set({ title: "Queued 1" }).where(job(a)));
    await asApp(a, (tx) => tx.update(s.job).set({ title: "Queued 2" }).where(job(a)));
    const claimed = await claimOutboxEvents(t.owner, 10);
    expect(claimed.map((c) => c.attempts)).toEqual([1, 1]);
    expect(claimed[0]).toMatchObject({
      organizationId: a.orgId,
      organizationName: "Org hooks",
      type: "job.updated",
    });
    expect(await claimOutboxEvents(t.owner, 10)).toEqual([]); // leased

    expect(await markOutboxFailed(t.owner, claimed[0]!.id, 1, "Relay can't be reached")).toBe("retry");
    await markOutboxSent(t.owner, claimed[1]!.id, "evt_ok");
    expect(await claimOutboxEvents(t.owner, 10)).toEqual([]); // backing off

    await t.owner
      .update(s.outboxEvent)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.outboxEvent.id, claimed[0]!.id));
    const again = await claimOutboxEvents(t.owner, 10);
    expect(again.map((c) => [c.id, c.attempts])).toEqual([[claimed[0]!.id, 2]]);
    expect(await markOutboxFailed(t.owner, claimed[0]!.id, OUTBOX_MAX_ATTEMPTS, "x".repeat(900))).toBe(
      "failed",
    );
    const [failed] = await t.owner.select().from(s.outboxEvent).where(eq(s.outboxEvent.id, claimed[0]!.id));
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed?.error).toHaveLength(500);
    const [sent] = await t.owner.select().from(s.outboxEvent).where(eq(s.outboxEvent.id, claimed[1]!.id));
    expect(sent).toMatchObject({ status: "sent", relayEventId: "evt_ok", error: null });
  });

  it("takes back events a stopped worker held past the lease", async () => {
    await asApp(a, (tx) => tx.update(s.job).set({ title: "Leased" }).where(job(a)));
    const [held] = await claimOutboxEvents(t.owner, 1);
    await t.owner
      .update(s.outboxEvent)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.outboxEvent.id, held!.id));
    const [retaken] = await claimOutboxEvents(t.owner, 1);
    expect(retaken).toMatchObject({ id: held!.id, attempts: 2 });
  });

  it("backs off 30 s, doubling, capped at an hour", () => {
    expect([1, 2, 3, 7, 8, 12].map(outboxBackoffSeconds)).toEqual([30, 60, 120, 1920, 3600, 3600]);
    expect(outboxBackoffSeconds(0)).toBe(30);
  });

  it("deletes sent events after 7 days and failed ones after 30", async () => {
    const old = (days: number) => new Date(Date.now() - days * 86_400_000);
    await t.owner.insert(s.outboxEvent).values([
      { organizationId: a.orgId, type: "job.created", payload: {}, status: "sent", sentAt: old(8) },
      { organizationId: a.orgId, type: "job.created", payload: {}, status: "sent", sentAt: old(1) },
      { organizationId: a.orgId, type: "job.created", payload: {}, status: "failed", createdAt: old(31) },
      { organizationId: a.orgId, type: "job.created", payload: {}, status: "failed", createdAt: old(2) },
      { organizationId: a.orgId, type: "job.created", payload: {}, status: "pending", createdAt: old(40) },
    ]);
    expect(await deleteOldOutboxEvents(t.owner)).toBe(2);
    expect(await t.owner.select().from(s.outboxEvent)).toHaveLength(3);
  });
});

describe("publishing to Relay", () => {
  it("delivers trigger-written events through Relay once, creating a missing tenant", async () => {
    const fake = await startFakeRelay({ apiKey: "rk_int" });
    try {
      const relay = createRelayClient({ url: fake.url, apiKey: "rk_int" });
      await asApp(a, (tx) => tx.update(s.job).set({ status: "in_progress" }).where(job(a)));
      // No tenant yet: the publisher creates it and posts again.
      expect(await publishOutbox(t.owner, relay)).toBe(1);
      const { endpoint } = await relay.createEndpoint(a.orgId, {
        url: "https://hooks.example.com/fieldops",
        description: null,
        event_types: ["job.completed"],
      });
      await asApp(a, (tx) =>
        tx.update(s.job).set({ status: "completed", completedAt: new Date() }).where(job(a)),
      );
      expect(await publishOutbox(t.owner, relay)).toBe(2);
      expect(await publishOutbox(t.owner, relay)).toBe(0);
      const deliveries = await relay.listDeliveries(a.orgId, { endpointId: endpoint.id });
      expect(deliveries.items).toHaveLength(1);
      const types = await withStore(t.app, a.orgId, (store) =>
        store.webhooks.eventTypes(deliveries.items.map((d) => d.event_id)),
      );
      expect(Object.values(types)).toEqual(["job.completed"]);
      expect(fake.events().map((e) => e.type)).toEqual([
        "job.status_changed",
        "job.status_changed",
        "job.completed",
      ]);
      const rows = await t.owner.select().from(s.outboxEvent);
      expect(rows.every((r) => r.status === "sent" && r.relayEventId?.startsWith("evt_"))).toBe(true);
      await asApp(a, (tx) => tx.update(s.job).set({ status: "scheduled", completedAt: null }).where(job(a)));
    } finally {
      await fake.close();
    }
  });

  it("keeps events Relay refused for a later try and reports them", async () => {
    await asApp(a, (tx) => tx.update(s.job).set({ title: "Relay down" }).where(job(a)));
    const down: EventRelay = createRelayClient({ url: "http://127.0.0.1:9", apiKey: "x", timeoutMs: 300 });
    const failures: OutboxFailure[] = [];
    expect(await publishOutbox(t.owner, down, { onFailure: (f) => failures.push(f) })).toBe(0);
    expect(failures).toEqual([
      expect.objectContaining({
        type: "job.updated",
        attempt: 1,
        outcome: "retry",
        error: "Relay can't be reached",
      }),
    ]);
    const refusing = {
      publish: async () => Promise.reject(new RelayError("nope", 422, "validation_failed")),
    };
    await t.owner.update(s.outboxEvent).set({ nextAttemptAt: new Date(0) });
    await publishOutbox(t.owner, refusing as unknown as EventRelay, { onFailure: (f) => failures.push(f) });
    expect(failures[1]).toMatchObject({ attempt: 2, error: "nope" });
    const [row] = await t.owner.select().from(s.outboxEvent);
    expect(row).toMatchObject({ status: "pending", attempts: 2, error: "nope" });
  });
});
