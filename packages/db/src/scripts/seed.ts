import { createDb } from "../client";
import { seedDemo, wipeAll } from "../seed";

const url = process.env.MIGRATION_DATABASE_URL;
const password = process.env.DEMO_PASSWORD;
if (!url || !password) throw new Error("MIGRATION_DATABASE_URL and DEMO_PASSWORD must be set");
const { db, pool } = createDb(url, { max: 2, application: "fieldops-seed" });
const started = Date.now();
await wipeAll(db);
const result = await seedDemo(db, { password });
for (const o of result.organizations) console.log(`${o.slug}: ${o.customers} customers, ${o.jobs} jobs`);
console.log(`seeded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
await pool.end();
