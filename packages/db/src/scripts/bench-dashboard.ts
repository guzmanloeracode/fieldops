import { performance } from "node:perf_hooks";
import { dashboard, type Actor, type ServiceContext } from "@fieldops/core";
import type { Role } from "@fieldops/shared";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../schema";
import { withStore } from "../store";

// DSH-06: the dashboard responses must stay under 800 ms (p95) on demo data. This runs the same service calls
// the dashboard page makes (overview for several periods, today) against a seeded database and prints
// p50 / p95 / max per scenario. With --explain it also prints the plan of every SQL statement once.
//
//   DATABASE_URL=postgres://fieldops_app:…@host/db pnpm --filter @fieldops/db bench:dashboard [-- --runs 50 --explain]

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1]) || 30;
const explain = args.includes("--explain");
const url = process.env.DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (app role, row-level security) or MIGRATION_DATABASE_URL");

const captured: { query: string; params: unknown[] }[] = [];
let capture = false;
const pool = new pg.Pool({ connectionString: url, max: 4, application_name: "fieldops-bench" });
const db = drizzle(pool, {
  schema,
  logger: {
    logQuery(query, params) {
      if (capture) captured.push({ query, params });
    },
  },
});

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

const orgs = await pool.query<{ id: string; slug: string }>(
  "select o.id, o.slug from organization o order by o.slug",
);
let worst = 0;
for (const org of orgs.rows) {
  const owner = await pool.query<{ member_id: string; user_id: string; name: string }>(
    `select m.id as member_id, u.id as user_id, u.name from member m join "user" u on u.id = m.user_id
      where m.organization_id = $1 and m.role = 'owner' order by m.created_at limit 1`,
    [org.id],
  );
  const o = owner.rows[0];
  if (!o) continue;
  const actor: Actor = {
    userId: o.user_id,
    memberId: o.member_id,
    organizationId: org.id,
    role: "owner" as Role,
    name: o.name,
  };
  const ctxFor = (store: ServiceContext["store"]): ServiceContext => ({
    actor,
    store,
    now: new Date(),
    demo: false,
  });
  const scenarios: [string, (ctx: ServiceContext) => Promise<unknown>][] = [
    ["overview 7d", (ctx) => dashboard.getOverview(ctx, { range: "7d" })],
    ["overview 30d", (ctx) => dashboard.getOverview(ctx, { range: "30d" })],
    ["overview 90d", (ctx) => dashboard.getOverview(ctx, { range: "90d" })],
    ["today", (ctx) => dashboard.getToday(ctx)],
  ];
  console.log(`\n${org.slug} (${runs} runs each)`);
  for (const [name, fn] of scenarios) {
    // Warm-up, and capture the statements once for --explain.
    capture = explain;
    await withStore(db, org.id, (store) => fn(ctxFor(store)));
    capture = false;
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      await withStore(db, org.id, (store) => fn(ctxFor(store)));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = percentile(times, 95);
    worst = Math.max(worst, p95);
    console.log(
      `  ${name.padEnd(14)} p50 ${percentile(times, 50).toFixed(1).padStart(6)} ms   p95 ${p95.toFixed(1).padStart(6)} ms   max ${times.at(-1)!.toFixed(1).padStart(6)} ms`,
    );
  }
  if (explain) {
    const client = await pool.connect();
    try {
      const seen = new Set<string>();
      for (const { query, params } of captured) {
        if (seen.has(query) || !/^\s*select/i.test(query) || query.includes("set_config")) continue;
        seen.add(query);
        await client.query("begin");
        await client.query("select set_config('app.org_id', $1, true)", [org.id]);
        const plan = await client.query<{ "QUERY PLAN": string }>(
          `explain (analyze, buffers) ${query}`,
          params,
        );
        await client.query("rollback");
        const lines = plan.rows.map((r) => r["QUERY PLAN"]);
        const scans = lines.filter((l) => /Scan|Execution Time/.test(l)).map((l) => l.trim());
        console.log(`\n  ${query.replace(/\s+/g, " ").slice(0, 110)}…`);
        for (const l of scans) console.log(`    ${l}`);
      }
    } finally {
      client.release();
    }
    captured.length = 0;
  }
}
console.log(`\nworst p95: ${worst.toFixed(1)} ms (target < 800 ms)`);
await pool.end();
if (worst >= 800) process.exitCode = 1;
