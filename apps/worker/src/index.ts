import { createDb, runMigrations, schema } from "@fieldops/db";
import { count } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { resetDemo } from "./demo";
import { drainOutbox, releaseStuck } from "./email";
import { env } from "./env";
import { log } from "./log";

const command = process.argv[2] ?? "run";

async function migrate() {
  await runMigrations({
    url: env.databaseUrl,
    migrationsFolder: env.migrationsFolder,
    appPassword: env.appDbPassword,
  });
  log.info("migrations applied");
}

async function run() {
  const { db, pool } = createDb(env.databaseUrl, { max: 5, application: "fieldops-worker" });

  if (env.demoMode) {
    if (!env.demoPassword) throw new Error("DEMO_PASSWORD is required in demo mode");
    const [orgs] = await db.select({ n: count() }).from(schema.organization);
    if (!orgs?.n) {
      log.info("empty database in demo mode: seeding");
      await resetDemo(db);
    }
  }

  // pg-boss keeps scheduled jobs durable in Postgres (ADR 007).
  const boss = new PgBoss({
    connectionString: env.databaseUrl,
    schema: "pgboss",
    application_name: "fieldops-boss",
  });
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();

  await boss.createQueue("maintenance");
  await boss.schedule("maintenance", "30 3 * * *", {}, { tz: "UTC" });
  await boss.work("maintenance", async () => {
    await pool.query(`delete from email_outbox where created_at < now() - interval '14 days'`);
    await pool.query(`delete from idempotency_key where created_at < now() - interval '24 hours'`);
    await pool.query(`delete from verification where expires_at < now() - interval '1 day'`);
    await pool.query(`delete from session where expires_at < now()`);
    // Read notifications are kept 90 days, unread ones a year (NOT-01).
    await pool.query(
      `delete from notification where (read_at is not null and created_at < now() - interval '90 days')
         or created_at < now() - interval '365 days'`,
    );
    log.info("maintenance done");
  });

  if (env.demoMode) {
    await boss.createQueue("demo-reset");
    await boss.schedule("demo-reset", "0 0 * * *", {}, { tz: "UTC" });
    await boss.work("demo-reset", async () => resetDemo(db));
  } else {
    await boss.unschedule("demo-reset").catch(() => undefined);
  }

  // Email outbox: short poll loop. Cheap, immediate, and safe with several workers (SKIP LOCKED).
  let stopping = false;
  const loop = async () => {
    while (!stopping) {
      try {
        await releaseStuck(pool);
        const n = await drainOutbox(pool);
        if (n) log.info({ n }, "emails processed");
      } catch (err) {
        log.error({ err }, "outbox loop failed");
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  };
  const looping = loop();
  log.info({ demo: env.demoMode }, "worker started");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    stopping = true;
    await boss.stop({ graceful: true, timeout: 20_000 });
    await looping;
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function reset() {
  const { db, pool } = createDb(env.databaseUrl, { max: 2, application: "fieldops-reset" });
  await resetDemo(db);
  await pool.end();
}

const commands: Record<string, () => Promise<void>> = { run, migrate, reset };
const fn = commands[command];
if (!fn) {
  log.error(`unknown command ${command}; use run | migrate | reset`);
  process.exit(1);
}
fn().catch((err) => {
  log.fatal({ err }, `${command} failed`);
  process.exit(1);
});
