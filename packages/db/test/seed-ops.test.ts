import { recurrences, sla } from "@fieldops/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../src/seed";
import { withStore } from "../src/store";
import { freshDatabase, type TestDb } from "./helpers";

// The demo seed's maintenance plans (JOB-13), paused SLA clocks (SLA-04) and digest log (NOT-04).

const NOW = new Date("2026-11-10T00:00:00Z");
let t: TestDb;

beforeAll(async () => {
  t = await freshDatabase();
  await seedDemo(t.owner, { now: NOW, password: "demo-test-password", days: 45 });
}, 180_000);
afterAll(async () => t?.close());

describe("demo seed: operations (0.4)", () => {
  it("gives every commercial customer one to three maintenance plans", async () => {
    const r = await t.owner.execute<{
      slug: string;
      customers: number;
      min: number;
      max: number;
      wrong: number;
    }>(sql`
      select o.slug, count(distinct c.id)::int as customers,
             min(n.plans)::int as min, max(n.plans)::int as max,
             (select count(*)::int from job_recurrence p join site s on s.id = p.site_id
               where p.organization_id = o.id and s.customer_id <> p.customer_id) as wrong
        from organization o
        join customer c on c.organization_id = o.id and c.type = 'commercial'
        cross join lateral (select count(*) as plans from job_recurrence p where p.customer_id = c.id) n
       group by o.id, o.slug order by o.slug`);
    for (const row of r.rows) {
      expect(row.customers, row.slug).toBeGreaterThan(10);
      expect(row, row.slug).toMatchObject({ min: 1, max: 3, wrong: 0 });
    }
    const statuses = await t.owner.execute<{ active: number; paused: number; ended: number }>(sql`
      select count(*) filter (where active and (ends_on is null or next_on <= ends_on))::int as active,
             count(*) filter (where not active)::int as paused,
             count(*) filter (where ends_on is not null and next_on > ends_on)::int as ended
        from job_recurrence`);
    expect(statuses.rows[0]!.active).toBeGreaterThan(50);
    expect(statuses.rows[0]!.paused).toBeGreaterThan(0);
    expect(statuses.rows[0]!.ended).toBeGreaterThan(0);
  });

  it("has created the jobs within each plan's lead time, like the generator", async () => {
    const r = await t.owner.execute<{ jobs: number; outside: number; behind: number; assigned: number }>(sql`
      select count(*)::int as jobs,
        count(*) filter (where j.occurrence_date < (${NOW}::timestamptz at time zone o.timezone)::date
          or j.occurrence_date > (${NOW}::timestamptz at time zone o.timezone)::date + p.lead_days)::int as outside,
        count(*) filter (where p.next_on <= j.occurrence_date)::int as behind,
        count(*) filter (where j.status <> 'new' or exists (select 1 from job_assignment a where a.job_id = j.id)
          or j.source <> 'recurring' or j.preferred_start is null or j.response_due_at is null)::int as assigned
        from job j
        join job_recurrence p on p.id = j.recurrence_id
        join organization o on o.id = j.organization_id`);
    expect(r.rows[0]!.jobs).toBeGreaterThan(20);
    expect(r.rows[0]).toMatchObject({ outside: 0, behind: 0, assigned: 0 });
    // A generator run right after the reset has nothing left to do.
    const orgs = await t.owner.execute<{ id: string }>(sql`select id from organization`);
    for (const { id } of orgs.rows) {
      expect(await withStore(t.owner, id, (store) => recurrences.generateDue({ store, now: NOW }))).toBe(0);
    }
  });

  it("pauses the resolution clock of jobs on hold for the customer, and the monitor leaves them alone", async () => {
    const r = await t.owner.execute<{
      slug: string;
      paused: number;
      unpaused: number;
      elsewhere: number;
    }>(sql`
      select o.slug,
        count(*) filter (where j.status = 'on_hold' and j.hold_reason = 'customer' and j.sla_paused_at is not null)::int as paused,
        count(*) filter (where j.status = 'on_hold' and j.hold_reason = 'customer' and j.sla_paused_at is null)::int as unpaused,
        count(*) filter (where j.sla_paused_at is not null and (j.status <> 'on_hold' or j.hold_reason <> 'customer'))::int as elsewhere
        from job j join organization o on o.id = j.organization_id group by o.slug order by o.slug`);
    for (const row of r.rows) expect(row, row.slug).toMatchObject({ unpaused: 0, elsewhere: 0 });
    expect(r.rows.some((row) => row.paused > 0)).toBe(true);
    const orgs = await t.owner.execute<{ id: string }>(sql`select id from organization`);
    for (const { id } of orgs.rows) {
      const result = await withStore(t.owner, id, (store) => sla.monitorSla({ store, now: NOW }));
      expect(result.alerts).toBe(0);
    }
  });

  it("logs yesterday's digest for each owner", async () => {
    const r = await t.owner.execute<{ role: string; d: string }>(sql`
      select m.role, d.digest_date::text as d from daily_digest d
        join member m on m.user_id = d.user_id and m.organization_id = d.organization_id order by d.digest_date`);
    expect(r.rows.map((x) => x.role)).toEqual(["owner", "owner"]);
  });
});
