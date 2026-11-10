import "server-only";
import { createDb, type Database } from "@fieldops/db";
import { env } from "@/env";

// One pool per server process. The web app connects as fieldops_app, so row-level security applies.
const globalForDb = globalThis as unknown as { fieldopsDb?: ReturnType<typeof createDb> };
const instance = (globalForDb.fieldopsDb ??= createDb(env.DATABASE_URL, { max: 10, application: "fieldops-web" }));

export const db: Database = instance.db;
export const pool = instance.pool;
