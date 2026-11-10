import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/client";
import { DEMO_LOGINS, seedDemo, wipeAll } from "../src/seed";
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

  it("wipes everything before a reset", async () => {
    await wipeAll(second.owner);
    const r = await second.owner.execute<{ n: number }>(
      sql`select (select count(*) from job)::int + (select count(*) from "user")::int + (select count(*) from organization)::int as n`,
    );
    expect(r.rows[0]!.n).toBe(0);
  });
});
