import {
  digest,
  jobs,
  recurrences,
  sla,
  type Actor,
  type DigestMailer,
  type ServiceContext,
  type Store,
} from "@fieldops/core";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, pgErrorOf, type OrgData, type TestDb } from "./helpers";

// Maintenance plans (JOB-13), the SLA pause (SLA-04) and the daily digest (NOT-04) against PostgreSQL, through
// the runtime role and row-level security. The helper organizations are in America/Chicago (CST, UTC-6).

let t: TestDb;
let a: OrgData;
let b: OrgData;
const at = (iso: string) => new Date(iso);
// Tuesday 10 Nov 2026, 09:00 in Chicago.
const NOW = at("2026-11-10T15:00:00Z");

function actor(org: OrgData, who: "owner" | "dispatcher" | "tech"): Actor {
  return {
    userId: org.users[who],
    memberId: org.members[who],
    organizationId: org.orgId,
    role: who === "tech" ? "technician" : who,
    name: who,
  };
}
const as = <T>(
  org: OrgData,
  who: "owner" | "dispatcher" | "tech",
  fn: (ctx: ServiceContext) => Promise<T>,
  now = NOW,
) => withStore(t.app, org.orgId, (store: Store) => fn({ actor: actor(org, who), store, now, demo: false }));
const runIn = <T>(org: OrgData, fn: (store: Store) => Promise<T>) => withStore(t.app, org.orgId, fn);

async function planJobs(planId: string) {
  const r = await t.owner.execute<{
    number: number;
    occurrence_date: string;
    source: string;
    status: string;
  }>(
    sql`select number, occurrence_date::text, source, status from job where recurrence_id = ${planId}
         order by occurrence_date`,
  );
  return r.rows;
}

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
  // The helper's plan and digest rows are for the isolation tests; these tests start clean.
  await t.owner.execute(sql`delete from job_recurrence`);
  await t.owner.execute(sql`delete from daily_digest`);
  await t.owner.execute(sql`delete from sla_alert`);
  await t.owner.execute(sql`update service_type set default_duration_min = 90,
    checklist_template = '[{"label":"Clean filters","kind":"checkbox","required":true}]'::jsonb`);
});
afterAll(async () => t?.close());

describe("maintenance plans (JOB-13)", () => {
  const input = (org: OrgData, extra: Record<string, unknown> = {}) => ({
    customer_id: org.ids.customer,
    site_id: org.ids.site,
    equipment_id: org.ids.equipment,
    service_type_id: org.ids.serviceType,
    title: "Monthly filter service",
    interval_unit: "month",
    interval_count: 1,
    starts_on: "2026-10-31",
    window_start: "09:00",
    window_minutes: 120,
    lead_days: 35,
    lead_member_id: org.members.tech,
    ...extra,
  });

  let planId: string;

  it("generates the jobs within the lead time when a plan is created", async () => {
    const plan = await as(a, "dispatcher", (ctx) => recurrences.createPlan(ctx, input(a)));
    planId = plan.id;
    // Month ends never drift: 30 Nov, 31 Dec (next), both from the 31 October start.
    expect(plan).toMatchObject({
      nextOn: "2026-12-31",
      jobCount: 1,
      lastOccurrence: "2026-11-30",
      leadMember: { memberId: a.members.tech, name: "a tech" },
      serviceType: { id: a.ids.serviceType, name: "AC repair" },
      site: { id: a.ids.site, label: "Home", city: "Austin" },
    });
    expect(await planJobs(plan.id)).toEqual([
      { number: 2, occurrence_date: "2026-11-30", source: "recurring", status: "new" },
    ]);
    const job = await runIn(a, (st) => st.jobs.getByNumber(2));
    expect(job).toMatchObject({
      recurrenceId: plan.id,
      // 09:00 in Chicago for two hours; the SLA clock starts at midnight on the visit date.
      preferredStart: at("2026-11-30T15:00:00Z"),
      preferredEnd: at("2026-11-30T17:00:00Z"),
      estimatedDurationMin: 90,
      responseDueAt: at("2026-12-01T06:00:00Z"),
      assignees: [],
    });
    const items = await t.owner.execute(sql`select label from checklist_item where job_id = ${job!.id}`);
    expect(items.rows).toEqual([{ label: "Clean filters" }]);
  });

  it("is idempotent: a second run, or one that lost its progress, creates nothing twice", async () => {
    expect(await runIn(a, (store) => recurrences.generateDue({ store, now: NOW }))).toBe(0);
    await t.owner.execute(sql`update job_recurrence set next_on = '2026-11-30' where id = ${planId}`);
    expect(await runIn(a, (store) => recurrences.generateDue({ store, now: NOW }))).toBe(0);
    expect(await planJobs(planId)).toHaveLength(1);
    // A month later the next visit is due; running twice still gives one job per date.
    const later = at("2026-12-01T15:00:00Z");
    expect(await runIn(a, (store) => recurrences.generateDue({ store, now: later }))).toBe(1);
    expect(await runIn(a, (store) => recurrences.generateDue({ store, now: later }))).toBe(0);
    expect((await planJobs(planId)).map((j) => j.occurrence_date)).toEqual(["2026-11-30", "2026-12-31"]);
    // The database refuses a second job for the same plan and date.
    expect(
      await pgErrorOf(
        t.owner.insert(s.job).values({
          organizationId: a.orgId,
          number: 999,
          customerId: a.ids.customer,
          siteId: a.ids.site,
          title: "Duplicate",
          recurrenceId: planId,
          occurrenceDate: "2026-12-31",
        }),
      ),
    ).toContain("job_org_recurrence_occurrence_uq");
  });

  it("skips plans another transaction is generating", async () => {
    await t.owner.execute(sql`update job_recurrence set next_on = '2027-01-31' where id = ${planId}`);
    const when = "2027-01-20";
    await runIn(a, async (store) => {
      expect((await store.recurrences.due(when)).map((p) => p.id)).toEqual([planId]);
      // A second worker at the same moment doesn't see the locked plan.
      expect(await runIn(a, (other) => other.recurrences.due(when))).toEqual([]);
    });
    expect((await runIn(a, (store) => store.recurrences.due(when))).map((p) => p.id)).toEqual([planId]);
  });

  it("lists, pages, edits and deletes plans inside the organization only", async () => {
    const second = await as(a, "dispatcher", (ctx) =>
      recurrences.createPlan(
        ctx,
        input(a, { title: "Yearly inspection", interval_unit: "year", starts_on: "2027-03-01" }),
      ),
    );
    const first = await runIn(a, (st) => st.recurrences.list({ limit: 1 }));
    expect(first.rows.map((p) => p.id)).toEqual([planId]);
    const next = await runIn(a, (st) => st.recurrences.list({ limit: 1, cursor: first.nextCursor! }));
    expect(next.rows.map((p) => p.id)).toEqual([second.id]);
    expect(next.nextCursor).toBeNull();
    expect(
      (await runIn(a, (st) => st.recurrences.list({ limit: 10, customerId: a.ids.customer, active: true })))
        .rows,
    ).toHaveLength(2);

    const paused = await as(a, "dispatcher", (ctx) => recurrences.pausePlan(ctx, second.id));
    expect(paused.active).toBe(false);
    expect((await runIn(a, (st) => st.recurrences.list({ limit: 10, active: false }))).rows).toHaveLength(1);
    expect(await runIn(b, (st) => st.recurrences.get(planId))).toBeNull();
    expect((await runIn(b, (st) => st.recurrences.list({ limit: 10 }))).rows).toEqual([]);
    expect(await runIn(b, (st) => st.recurrences.update(planId, { title: "x" }))).toBeNull();
    expect(await runIn(b, (st) => st.recurrences.softDelete(planId))).toBe(false);

    await as(a, "dispatcher", (ctx) => recurrences.deletePlan(ctx, second.id));
    expect(await runIn(a, (st) => st.recurrences.get(second.id))).toBeNull();
    // Audit history records plan changes (AUD-02).
    const audit = await t.owner.execute<{ action: string }>(
      sql`select action from audit_log where entity_id = ${second.id}::text order by created_at, id`,
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("doesn't generate for a deleted customer", async () => {
    await t.owner.execute(sql`update job_recurrence set next_on = '2026-11-10' where id = ${planId}`);
    await t.owner.execute(sql`update customer set deleted_at = now() where id = ${a.ids.customer}`);
    expect(await runIn(a, (st) => st.recurrences.due("2026-11-10"))).toEqual([]);
    await t.owner.execute(sql`update customer set deleted_at = null where id = ${a.ids.customer}`);
  });
});

describe("SLA pause (SLA-04)", () => {
  let jobId: string;

  it("pauses on hold for the customer and moves the deadline when work resumes", async () => {
    const job = await as(a, "dispatcher", (ctx) =>
      jobs.createJob(ctx, { customer_id: a.ids.customer, site_id: a.ids.site, title: "No cooling" }),
    );
    jobId = job.id;
    await as(a, "dispatcher", (ctx) =>
      jobs.assignJob(ctx, job.id, {
        member_ids: [a.members.tech],
        scheduled_start: "2026-11-10T16:00:00Z",
        scheduled_end: "2026-11-10T18:00:00Z",
        override_reason: "Test",
      }),
    );
    await as(a, "tech", (ctx) => jobs.transitionJob(ctx, job.id, { to: "in_progress" }));
    const held = await as(
      a,
      "tech",
      (ctx) => jobs.transitionJob(ctx, job.id, { to: "on_hold", reason: "Away", hold_reason: "customer" }),
      at("2026-11-10T17:00:00Z"),
    );
    expect(held.slaPausedAt).toEqual(at("2026-11-10T17:00:00Z"));
    const resumed = await as(
      a,
      "tech",
      (ctx) => jobs.transitionJob(ctx, job.id, { to: "in_progress" }),
      at("2026-11-11T17:00:00Z"),
    );
    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.slaPausedMinutes).toBe(1440);
    expect(resumed.resolutionDueAt!.getTime() - job.resolutionDueAt!.getTime()).toBe(86_400_000);
    const events = await runIn(a, (st) => st.jobs.events(job.id));
    expect(events.find((e) => e.toStatus === "on_hold")!.payload).toMatchObject({ sla_paused: true });
    expect(events.find((e) => e.fromStatus === "on_hold")!.payload).toMatchObject({
      sla_paused_minutes: 1440,
    });
  });

  it("never alerts while the clock is paused", async () => {
    await t.owner.execute(sql`update job set status = 'on_hold', hold_reason = 'customer',
      sla_paused_at = '2026-11-12T00:00:00Z', sla_resolution_state = 'on_track',
      resolution_at_risk_at = '2026-11-13T00:00:00Z', resolution_due_at = '2026-11-14T00:00:00Z'
      where id = ${jobId}`);
    const now = at("2026-12-01T00:00:00Z");
    await runIn(a, (store) => sla.monitorSla({ store, now }));
    const alerts = await t.owner.execute(sql`select 1 from sla_alert where job_id = ${jobId}`);
    expect(alerts.rows).toEqual([]);
    const state = await t.owner.execute<{ s: string }>(
      sql`select sla_resolution_state as s from job where id = ${jobId}`,
    );
    expect(state.rows[0]!.s).toBe("on_track");
    // Once the pause ends, the monitor picks the job up again.
    await t.owner.execute(sql`update job set sla_paused_at = null where id = ${jobId}`);
    await runIn(a, (store) => sla.monitorSla({ store, now }));
    const after = await t.owner.execute(sql`select kind from sla_alert where job_id = ${jobId}`);
    expect(after.rows).toEqual([{ kind: "breached" }]);
  });
});

describe("daily digest (NOT-04)", () => {
  // Friday 13 Nov 2026, 07:20 in Chicago; the digest covers Thursday the 12th.
  const SEVEN = at("2026-11-13T13:20:00Z");
  const sent: Parameters<DigestMailer["send"]>[0][] = [];
  const mailer: DigestMailer = { send: async (m) => void sent.push(m) };
  let adminUser: string;

  beforeAll(async () => {
    adminUser = randomUUID();
    await t.owner.insert(s.user).values({
      id: adminUser,
      name: "b admin",
      email: `admin.${b.orgId}@example.com`,
      emailVerified: true,
    });
    await t.owner.insert(s.member).values({ organizationId: b.orgId, userId: adminUser, role: "admin" });
    const job = (values: Partial<typeof s.job.$inferInsert>) =>
      t.owner.insert(s.job).values({
        organizationId: b.orgId,
        number: Math.floor(Math.random() * 1e9),
        customerId: b.ids.customer,
        siteId: b.ids.site,
        title: "Digest job",
        ...values,
      });
    // Created on the 12th (local), the 11th and the 13th; completed on the 12th: two met, one breached revisit.
    await job({ createdAt: at("2026-11-12T12:00:00Z") });
    await job({ createdAt: at("2026-11-13T06:00:00Z") });
    await job({ createdAt: at("2026-11-12T05:59:00Z") });
    const done = {
      status: "completed",
      completedAt: at("2026-11-12T20:00:00Z"),
      createdAt: at("2026-11-01T00:00:00Z"),
    };
    await job({ ...done, slaResolutionState: "met" });
    await job({ ...done, slaResolutionState: "met" });
    await job({ ...done, slaResolutionState: "breached", revisit: true });
    // Open and overdue: one breached, one paused but breached before, one at risk.
    await job({
      title: "Overdue boiler",
      status: "in_progress",
      firstScheduledAt: at("2026-11-02T00:00:00Z"),
      slaResolutionState: "breached",
      resolutionDueAt: at("2026-11-05T00:00:00Z"),
    });
    await job({
      title: "At risk",
      status: "new",
      slaResponseState: "at_risk",
      slaResolutionState: "on_track",
    });
    // Money on the 12th: an invoice issued and a payment received (a draft and another day don't count).
    const invoice = randomUUID();
    await t.owner.insert(s.invoice).values([
      {
        id: invoice,
        organizationId: b.orgId,
        customerId: b.ids.customer,
        status: "sent",
        currency: "USD",
        totalMinor: 40000,
        issueDate: "2026-11-12",
      },
      {
        organizationId: b.orgId,
        customerId: b.ids.customer,
        status: "draft",
        currency: "USD",
        totalMinor: 99900,
        issueDate: "2026-11-12",
      },
    ]);
    await t.owner.insert(s.payment).values([
      {
        organizationId: b.orgId,
        invoiceId: invoice,
        amountMinor: 15000,
        currency: "USD",
        method: "card",
        paidAt: at("2026-11-12T23:00:00Z"),
      },
      {
        organizationId: b.orgId,
        invoiceId: invoice,
        amountMinor: 5000,
        currency: "USD",
        method: "cash",
        paidAt: at("2026-11-13T07:00:00Z"),
      },
    ]);
  });

  it("computes yesterday's figures in SQL", async () => {
    const summary = await runIn(b, (st) => st.digest.summary("2026-11-12", 5));
    expect(summary).toMatchObject({
      date: "2026-11-12",
      jobsCreated: 1,
      jobsCompleted: 3,
      slaMet: 2,
      slaMeasured: 3,
      firstVisit: 2,
      currency: "USD",
      invoicedMinor: 40000,
      // The helper's payment at 04:00 on the 12th counts too.
      collectedMinor: 16000,
      overdueCount: 1,
      pendingApprovals: 1,
    });
    expect(summary.overdue).toEqual([
      expect.objectContaining({
        title: "Overdue boiler",
        customerName: "Customer b",
        dueAt: at("2026-11-05T00:00:00Z"),
      }),
    ]);
    // Nothing happened on a quiet day; organization A's data never shows up.
    const quiet = await runIn(b, (st) => st.digest.summary("2026-10-01", 5));
    expect(quiet).toMatchObject({ jobsCreated: 0, jobsCompleted: 0, invoicedMinor: 0, collectedMinor: 0 });
  });

  it("goes to owners and to admins who turned it on, once per local day", async () => {
    expect((await runIn(b, (st) => st.digest.recipients("2026-11-13"))).map((r) => r.role)).toEqual([
      "owner",
    ]);
    await t.owner.insert(s.notificationPreference).values({
      organizationId: b.orgId,
      userId: adminUser,
      event: "daily_digest",
      inApp: false,
      email: true,
    });
    // Not at 06:59 local.
    expect(
      await runIn(b, (store) => digest.sendDailyDigests({ store, mailer, now: at("2026-11-13T12:59:00Z") })),
    ).toBe(0);
    expect(await runIn(b, (store) => digest.sendDailyDigests({ store, mailer, now: SEVEN }))).toBe(2);
    expect(sent.map((m) => [m.recipient.role, m.date, m.summary.date])).toEqual([
      ["owner", "2026-11-13", "2026-11-12"],
      ["admin", "2026-11-13", "2026-11-12"],
    ]);
    expect(await runIn(b, (store) => digest.sendDailyDigests({ store, mailer, now: SEVEN }))).toBe(0);
    const rows = await t.owner.execute(
      sql`select digest_date::text as d from daily_digest where organization_id = ${b.orgId}`,
    );
    expect(rows.rows).toEqual([{ d: "2026-11-13" }, { d: "2026-11-13" }]);
    expect(await runIn(b, (st) => st.digest.record(adminUser, "2026-11-13", SEVEN))).toBe(false);
    // The owner turned it off: no digest the next day for them.
    await t.owner.insert(s.notificationPreference).values({
      organizationId: b.orgId,
      userId: b.users.owner,
      event: "daily_digest",
      inApp: false,
      email: false,
    });
    expect((await runIn(b, (st) => st.digest.recipients("2026-11-14"))).map((r) => r.role)).toEqual([
      "admin",
    ]);
    // Organization A's owner is separate.
    expect((await runIn(a, (st) => st.digest.recipients("2026-11-13"))).map((r) => r.userId)).toEqual([
      a.users.owner,
    ]);
  });
});
