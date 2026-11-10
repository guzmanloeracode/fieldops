import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

/**
 * Applies the SQL migrations (forward only) as the table owner, then gives the runtime role
 * `fieldops_app` its login password so the web app can connect with row-level security enforced.
 */
export async function runMigrations(opts: { url: string; migrationsFolder: string; appPassword?: string }) {
  const { db, pool } = createDb(opts.url, { max: 1, application: "fieldops-migrate" });
  try {
    await migrate(db, { migrationsFolder: opts.migrationsFolder });
    if (opts.appPassword) {
      const client = await pool.connect();
      try {
        await client.query(
          `ALTER ROLE fieldops_app LOGIN PASSWORD ${client.escapeLiteral(opts.appPassword)}`,
        );
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}
