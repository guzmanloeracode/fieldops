import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../src/seed";
import { freshDatabase, type TestDb } from "./helpers";

// SCH-04 seed: working hours, skills and time off, with upcoming visits kept clear of time off.

const NOW = new Date("2026-11-10T00:00:00Z");
let t: TestDb;

beforeAll(async () => {
  t = await freshDatabase();
  await seedDemo(t.owner, { now: NOW, password: "demo-test-password", days: 30 });
}, 180_000);
afterAll(async () => t?.close());

describe("dispatch seed", () => {
  it("gives a few technicians their own hours and keeps Tom on business hours", async () => {
    const r = await t.owner.execute<{ name: string; own: boolean; skills: string[] }>(sql`
      select u.name, m.working_hours is not null as own, m.skills
      from member m join "user" u on u.id = m.user_id where m.role = 'technician' order by u.name`);
    const byName = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(byName["Tom Reyes"]).toMatchObject({ own: false, skills: ["ac", "electrical"] });
    expect(r.rows.filter((x) => x.own).map((x) => x.name)).toEqual([
      "Dewi Lestari",
      "Grace Kim",
      "Hannah Olsen",
      "Luis Moreno",
      "Rizky Ramadhan",
    ]);
    expect(byName["Luis Moreno"]!.skills).toContain("electrical");
  });

  it("schedules time off tomorrow, after the seeded week and in the past, never for demo accounts", async () => {
    const r = await t.owner.execute<{
      slug: string;
      name: string;
      days_from_now: number;
      length: number;
    }>(sql`
      select org.slug, u.name,
        round(extract(epoch from (o.starts_at - ${NOW.toISOString()}::timestamptz)) / 86400)::int as days_from_now,
        round(extract(epoch from (o.ends_at - o.starts_at)) / 86400)::int as length
      from time_off o join member m on m.id = o.member_id join "user" u on u.id = m.user_id
      join organization org on org.id = o.organization_id order by org.slug, o.starts_at`);
    expect(r.rows.map((x) => x.name)).not.toEqual(expect.arrayContaining(["Tom Reyes"]));
    expect(r.rows.map((x) => x.name)).not.toEqual(expect.arrayContaining(["Agus Prasetyo"]));
    for (const slug of ["acme-air", "acme-teknik"]) {
      const rows = r.rows.filter((x) => x.slug === slug);
      // Tomorrow, one day (the reset is at 00:00 UTC; tomorrow starts about a day and a quarter later).
      expect(rows.filter((x) => x.days_from_now === 1 && x.length === 1)).toHaveLength(1);
      expect(rows.filter((x) => x.days_from_now >= 8 && x.length === 3)).toHaveLength(1);
      expect(rows.some((x) => x.days_from_now < -7)).toBe(true);
    }
  });

  it("keeps upcoming scheduled visits clear of the assignee's time off", async () => {
    const r = await t.owner.execute<{ n: number }>(sql`
      select count(*)::int as n from job j
      join job_assignment a on a.job_id = j.id
      join time_off o on o.member_id = a.member_id
      where j.status = 'scheduled' and j.scheduled_start >= ${NOW.toISOString()}::timestamptz
        and j.scheduled_start < o.ends_at and o.starts_at < j.scheduled_end`);
    expect(r.rows[0]!.n).toBe(0);
  });

  it("keeps the assignment events in step with reassigned visits", async () => {
    const r = await t.owner.execute<{ n: number }>(sql`
      select count(*)::int as n from job j
      join job_event e on e.job_id = j.id and e.type = 'assigned'
      where j.status = 'scheduled' and not exists (
        select 1 from job_assignment a where a.job_id = j.id and (e.payload->'member_ids') ? a.member_id::text)`);
    expect(r.rows[0]!.n).toBe(0);
  });
});
