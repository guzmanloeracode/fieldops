import { intakeDraftSchema } from "@fieldops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/client";
import { DEMO_LOGINS, seedDemo, wipeAll } from "../src/seed";
import { withStore } from "../src/store";
import { freshDatabase, type TestDb } from "./helpers";

// DEM-02/03: a deterministic seed whose dates are relative to the reset time.

const NOW = new Date("2026-11-10T00:00:00Z");
const DAYS = 45;
let first: TestDb;
let second: TestDb;

async function fingerprint(db: Database) {
  const counts = await db.execute<Record<string, number>>(sql`select
    (select count(*)::int from organization) as orgs,
    (select count(*)::int from "user") as users,
    (select count(*)::int from member) as members,
    (select count(*)::int from customer) as customers,
    (select count(*)::int from contact) as contacts,
    (select count(*)::int from site) as sites,
    (select count(*)::int from equipment) as equipment,
    (select count(*)::int from service_type) as service_types,
    (select count(*)::int from job) as jobs,
    (select count(*)::int from job_assignment) as assignments,
    (select count(*)::int from job_event) as events,
    (select count(*)::int from note) as notes`);
  const jobs = await db.execute<{ row: string }>(sql`
    select concat_ws('|', o.slug, j.number, j.title, j.status, j.priority, j.scheduled_start, j.created_at, c.name) as row
    from job j join organization o on o.id = j.organization_id join customer c on c.id = j.customer_id
    order by o.slug, j.number`);
  return { counts: counts.rows[0]!, jobs: jobs.rows.map((r) => r.row) };
}

beforeAll(async () => {
  [first, second] = await Promise.all([freshDatabase(), freshDatabase()]);
  await Promise.all([
    seedDemo(first.owner, { now: NOW, password: "demo-test-password", days: DAYS }),
    seedDemo(second.owner, { now: NOW, password: "demo-test-password", days: DAYS }),
  ]);
}, 180_000);
afterAll(async () => Promise.all([first?.close(), second?.close()]));

describe("demo seed", () => {
  it("is deterministic for the same reset time", async () => {
    const [a, b] = await Promise.all([fingerprint(first.owner), fingerprint(second.owner)]);
    expect(a.counts).toEqual(b.counts);
    expect(a.jobs).toEqual(b.jobs);
    expect(a.counts).toMatchObject({
      orgs: 2,
      users: 19,
      // Olivia (Acme Air owner) is also an admin of Acme Teknik (AUTH-06).
      members: 20,
      customers: 420,
      sites: 530,
      equipment: 680,
      service_types: 14,
    });
    expect(a.counts.jobs).toBeGreaterThan(1000);
  });

  it("numbers jobs 1..N per organization without gaps and sets the counter", async () => {
    const r = await first.owner.execute<{
      slug: string;
      n: number;
      min: number;
      max: number;
      counter: number;
    }>(sql`
      select o.slug, count(*)::int as n, min(j.number) as min, max(j.number) as max,
        (select value from org_counter c where c.organization_id = o.id and c.name = 'job') as counter
      from job j join organization o on o.id = j.organization_id group by o.id, o.slug`);
    for (const row of r.rows) expect(row).toMatchObject({ min: 1, max: row.n, counter: row.n });
  });

  it("never double-books a technician", async () => {
    const r = await first.owner.execute<{ n: number }>(sql`
      select count(*)::int as n from job_assignment a
      join job j on j.id = a.job_id
      join job_assignment b on b.member_id = a.member_id and b.job_id <> a.job_id
      join job k on k.id = b.job_id
      where j.scheduled_start < k.scheduled_end and k.scheduled_start < j.scheduled_end`);
    expect(r.rows[0]!.n).toBe(0);
  });

  it("keeps references consistent within each organization", async () => {
    const r = await first.owner.execute<Record<string, number>>(sql`select
      (select count(*)::int from job j join site s on s.id = j.site_id where s.customer_id <> j.customer_id) as wrong_site,
      (select count(*)::int from job j join site s on s.id = j.site_id where s.organization_id <> j.organization_id) as cross_org_site,
      (select count(*)::int from job j join equipment e on e.id = j.equipment_id where e.site_id <> j.site_id) as wrong_equipment,
      (select count(*)::int from job_assignment a join member m on m.id = a.member_id where m.organization_id <> a.organization_id) as cross_org_member,
      (select count(*)::int from job where status in ('scheduled','en_route','in_progress','completed') and (scheduled_start is null or scheduled_end <= scheduled_start)) as bad_window,
      (select count(*)::int from job where status = 'completed' and completed_at is null) as completed_without_time,
      (select count(*)::int from job where status = 'on_hold' and hold_reason is null) as hold_without_reason,
      (select count(*)::int from job j where status <> 'new' and not exists (select 1 from job_assignment a where a.job_id = j.id)) as unassigned_scheduled,
      (select count(*)::int from contact where email not like '%@example.com') as real_looking_emails,
      (select count(*)::int from "user" where email not like '%.example') as real_looking_user_emails`);
    expect(r.rows[0]).toEqual({
      wrong_site: 0,
      cross_org_site: 0,
      wrong_equipment: 0,
      cross_org_member: 0,
      bad_window: 0,
      completed_without_time: 0,
      hold_without_reason: 0,
      unassigned_scheduled: 0,
      real_looking_emails: 0,
      real_looking_user_emails: 0,
    });
  });

  it("shows a past history, a busy today and a week ahead, relative to the reset time", async () => {
    const r = await first.owner.execute<{
      slug: string;
      past: number;
      today: number;
      ahead: number;
      queue: number;
      review: number;
    }>(sql`
      select o.slug,
        count(*) filter (where j.scheduled_start < ${NOW.toISOString()}::timestamptz - interval '1 day')::int as past,
        count(*) filter (where (j.scheduled_start at time zone o.timezone)::date = ((${NOW.toISOString()}::timestamptz + interval '8 hours') at time zone o.timezone)::date)::int as today,
        count(*) filter (where j.scheduled_start > ${NOW.toISOString()}::timestamptz + interval '1 day')::int as ahead,
        count(*) filter (where j.status = 'new' and j.scheduled_start is null)::int as queue,
        count(*) filter (where j.needs_review)::int as review
      from job j join organization o on o.id = j.organization_id group by o.slug order by o.slug`);
    for (const row of r.rows) {
      expect(row.past).toBeGreaterThan(100);
      expect(row.today).toBeGreaterThan(3);
      expect(row.ahead).toBeGreaterThan(5);
      expect(row.queue).toBeGreaterThan(0);
      expect(row.review).toBeGreaterThan(0);
    }
    const latest = await first.owner.execute<{ max: Date }>(sql`select max(scheduled_start) as max from job`);
    expect(new Date(latest.rows[0]!.max).getTime()).toBeLessThan(NOW.getTime() + 9 * 86_400_000);
    const created = await first.owner.execute<{ max: Date }>(sql`select max(created_at) as max from job`);
    expect(new Date(created.rows[0]!.max).getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it("gives about 5% of past completed jobs a second visit, with a consistent timeline (DSH-01)", async () => {
    const r = await first.owner.execute<{
      slug: string;
      completed: number;
      revisits: number;
      bad: number;
    }>(sql`
      select o.slug,
        count(*) filter (where j.status = 'completed')::int as completed,
        count(*) filter (where j.status = 'completed' and j.revisit)::int as revisits,
        count(*) filter (where j.revisit and not (j.first_scheduled_at < j.scheduled_start
          and exists (select 1 from job_event e where e.job_id = j.id and e.type = 'assigned'
            and e.from_status = 'on_hold' and e.to_status = 'scheduled' and e.created_at < j.scheduled_start)))::int as bad
      from job j join organization o on o.id = j.organization_id group by o.slug order by o.slug`);
    for (const row of r.rows) {
      expect(row.revisits / row.completed).toBeGreaterThan(0.02);
      expect(row.revisits / row.completed).toBeLessThan(0.08);
      expect(row.bad).toBe(0);
    }
  });

  it("stores SLA policies, deadlines and states consistent with each job's timeline (SLA-01, SLA-02)", async () => {
    const r = await first.owner.execute<{
      slug: string;
      policies: number;
      missing: number;
      wrong: number;
      completed: number;
      breached: number;
      attention: number;
    }>(sql`
      select o.slug,
        (select count(*)::int from sla_policy p where p.organization_id = o.id) as policies,
        count(*) filter (where j.response_due_at is null or j.resolution_due_at is null
          or j.response_at_risk_at > j.response_due_at or j.resolution_at_risk_at > j.resolution_due_at
          or j.sla_policy_id is null)::int as missing,
        count(*) filter (where (j.status = 'completed' and j.sla_resolution_state is distinct from
            case when j.completed_at <= j.resolution_due_at then 'met' else 'breached' end)
          or (j.first_scheduled_at is not null and j.status <> 'canceled' and j.sla_response_state is distinct from
            case when j.first_scheduled_at <= j.response_due_at then 'met' else 'breached' end)
          or (j.status = 'canceled' and (j.sla_response_state is not null or j.sla_resolution_state is not null)))::int as wrong,
        count(*) filter (where j.status = 'completed')::int as completed,
        count(*) filter (where j.status = 'completed' and j.sla_resolution_state = 'breached')::int as breached,
        count(*) filter (where j.status not in ('completed', 'canceled')
          and (j.sla_response_state in ('at_risk', 'breached') or j.sla_resolution_state in ('at_risk', 'breached')))::int as attention
      from job j join organization o on o.id = j.organization_id group by o.id, o.slug order by o.slug`);
    for (const row of r.rows) {
      expect(row, row.slug).toMatchObject({ policies: 4, missing: 0, wrong: 0 });
      // About 8% of completed jobs breach their resolution target (PRD §19).
      expect(row.breached / row.completed).toBeGreaterThan(0.04);
      expect(row.breached / row.completed).toBeLessThan(0.12);
      expect(row.attention).toBeGreaterThan(0);
    }
  });

  it("records the past SLA alerts, so the monitor's first run raises nothing (SLA-03)", async () => {
    const orgs = await first.owner.execute<{ id: string }>(sql`select id from organization`);
    for (const { id } of orgs.rows) {
      const raised = await withStore(first.owner, id, (store) => store.sla.raiseAlerts(NOW));
      expect(raised).toEqual([]);
    }
    const alerts = await first.owner.execute<{ n: number }>(sql`select count(*)::int as n from sla_alert`);
    expect(alerts.rows[0]!.n).toBeGreaterThan(50);
  });

  it("creates the one-click demo accounts with verified emails and credentials", async () => {
    const emails = Object.values(DEMO_LOGINS).flatMap((o) => Object.values(o));
    const r = await first.owner.execute<{
      email: string;
      org: string;
      role: string;
      verified: boolean;
      has_password: boolean;
      is_demo: boolean;
    }>(sql`
      select u.email, o.slug as org, m.role, u.email_verified as verified, a.password is not null as has_password, u.is_demo
      from "user" u join member m on m.user_id = u.id
      join organization o on o.id = m.organization_id
      join account a on a.user_id = u.id and a.provider_id = 'credential'
      where u.email = any(${sql.raw(`array[${emails.map((e) => `'${e}'`).join(",")}]`)})`);
    // Six demo logins, plus Olivia's second membership (admin of Acme Teknik, AUTH-06).
    expect(r.rows).toHaveLength(7);
    for (const [org, logins] of Object.entries(DEMO_LOGINS)) {
      for (const [role, email] of Object.entries(logins)) {
        expect(
          r.rows.find((x) => x.email === email && x.org === org),
          `${org} ${role}`,
        ).toMatchObject({ role, verified: true, has_password: true, is_demo: true });
      }
    }
    expect(
      r.rows.find((x) => x.email === DEMO_LOGINS["acme-air"].owner && x.org === "acme-teknik"),
    ).toMatchObject({
      role: "admin",
    });
  });

  it("keeps the demo owner's first organization as the default and seeds shared views", async () => {
    const r = await first.owner.execute<{ slug: string }>(sql`
      select o.slug from member m join "user" u on u.id = m.user_id join organization o on o.id = m.organization_id
      where u.email = ${DEMO_LOGINS["acme-air"].owner} order by m.created_at limit 1`);
    expect(r.rows[0]!.slug).toBe("acme-air");
    const views = await first.owner.execute<{ slug: string; n: number }>(sql`
      select o.slug, count(*)::int as n from saved_view v join organization o on o.id = v.organization_id
      where v.shared group by o.slug order by o.slug`);
    expect(views.rows).toEqual([
      { slug: "acme-air", n: 4 },
      { slug: "acme-teknik", n: 4 },
    ]);
  });

  it("drafts the portal requests waiting for review and logs a month of AI use (AI-01)", async () => {
    const r = await first.owner.execute<{
      waiting: number;
      drafted: number;
      with_draft: number;
      calls: number;
      ai_jobs: number;
    }>(sql`select
      (select count(*)::int from job where needs_review) as waiting,
      (select count(*)::int from job where needs_review and ai_status = 'drafted') as drafted,
      (select count(*)::int from job j where j.needs_review and exists (
        select 1 from ai_interaction i where i.job_id = j.id and i.output is not null and i.outcome = 'drafted')) as with_draft,
      (select count(*)::int from ai_interaction) as calls,
      (select count(*)::int from job where source = 'ai_intake' and ai_drafted) as ai_jobs`);
    const c = r.rows[0]!;
    expect(c.waiting).toBeGreaterThan(0);
    expect(c.drafted).toBe(c.waiting);
    expect(c.with_draft).toBe(c.waiting);
    expect(c.calls).toBeGreaterThan(20);
    expect(c.ai_jobs).toBeGreaterThan(0);
    const drafts = await first.owner.execute<{ output: unknown }>(
      sql`select output from ai_interaction where output is not null and feature = 'intake'`,
    );
    for (const d of drafts.rows) expect(intakeDraftSchema.safeParse(d.output).success).toBe(true);
  });

  it("seeds recent notifications, the same for the same reset time (NOT-01)", async () => {
    const summary = (db: Database) =>
      db
        .execute<{ row: string }>(
          sql`
          select concat_ws('|', u.email, n.type, n.payload->>'job_number', n.created_at, n.read_at is null) as row
          from notification n join "user" u on u.id = n.user_id
          order by u.email, n.created_at, n.type, n.payload->>'job_number'`,
        )
        .then((r) => r.rows.map((x) => x.row));
    const [a, b] = await Promise.all([summary(first.owner), summary(second.owner)]);
    expect(a).toEqual(b);
    const r = await first.owner.execute<{ type: string; unread: number; future: number; old: number }>(sql`
      select n.type, count(*) filter (where n.read_at is null)::int as unread,
        count(*) filter (where n.created_at > ${NOW})::int as future,
        count(*) filter (where n.created_at < ${new Date(NOW.getTime() - 8 * 86_400_000)})::int as old
      from notification n join "user" u on u.id = n.user_id
      where u.email = ${DEMO_LOGINS["acme-air"].technician} group by n.type`);
    const tom = new Map(r.rows.map((x) => [x.type, x]));
    expect(tom.get("job_assigned")).toBeDefined();
    expect(r.rows.every((x) => x.future === 0 && x.old === 0)).toBe(true);
    expect(r.rows.reduce((n, x) => n + x.unread, 0)).toBeGreaterThan(0);
  });

  it("writes service reports for recent completed jobs, sent ones with their event (AI-03)", async () => {
    const summary = (db: Database) =>
      db
        .execute<{ row: string }>(
          sql`select concat_ws('|', o.slug, j.number, r.status, r.locale, r.ai_status, r.ai_drafted,
              r.edited_by is not null, r.next_service_date, r.sent_at, r.work_performed) as row
            from service_report r join job j on j.id = r.job_id join organization o on o.id = r.organization_id
            order by o.slug, j.number`,
        )
        .then((r) => r.rows.map((x) => x.row));
    const [a, b] = await Promise.all([summary(first.owner), summary(second.owner)]);
    expect(a).toEqual(b);
    const r = await first.owner.execute<{
      slug: string;
      reports: number;
      sent: number;
      drafts: number;
      ai: number;
      edited: number;
      locales: string;
      events: number;
      bad_jobs: number;
      outcomes: string;
    }>(sql`select o.slug,
        count(r.id)::int as reports,
        count(r.id) filter (where r.status = 'sent')::int as sent,
        count(r.id) filter (where r.status = 'draft')::int as drafts,
        count(r.id) filter (where r.ai_drafted)::int as ai,
        count(r.id) filter (where r.edited_by is not null)::int as edited,
        string_agg(distinct r.locale, ',') as locales,
        (select count(*)::int from job_event e where e.organization_id = o.id and e.type = 'report_sent') as events,
        count(r.id) filter (where j.status <> 'completed' or r.work_performed is null
          or (r.status = 'sent' and (r.sent_to is null or r.sent_at < j.completed_at or r.sent_at > ${NOW}))) as bad_jobs,
        (select string_agg(distinct i.outcome, ',' order by i.outcome) from ai_interaction i
          where i.organization_id = o.id and i.feature = 'report') as outcomes
      from organization o join service_report r on r.organization_id = o.id join job j on j.id = r.job_id
      group by o.id, o.slug order by o.slug`);
    expect(r.rows.map((x) => [x.slug, x.locales])).toEqual([
      ["acme-air", "en"],
      ["acme-teknik", "id"],
    ]);
    for (const x of r.rows) {
      expect(x.reports).toBeGreaterThan(5);
      expect(x.sent).toBeGreaterThan(x.drafts);
      expect(x.drafts).toBeGreaterThan(0);
      expect(x.ai).toBeGreaterThan(x.reports / 2);
      expect(x.edited).toBeGreaterThan(0);
      expect(x.events).toBe(x.sent);
      expect(Number(x.bad_jobs)).toBe(0);
      expect(x.outcomes).toContain("accepted");
    }
  });

  it("wipes everything before a reset", async () => {
    await wipeAll(second.owner);
    const r = await second.owner.execute<{ n: number }>(
      sql`select (select count(*) from job)::int + (select count(*) from "user")::int + (select count(*) from organization)::int as n`,
    );
    expect(r.rows[0]!.n).toBe(0);
  });
});
