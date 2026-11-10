import { sql } from "drizzle-orm";
import { env } from "@/env";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness and readiness for the uptime monitor and the deploy health check (PRD §15). */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { status: "ok", version: env.APP_VERSION, commit: env.APP_COMMIT, db_ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "error", version: env.APP_VERSION }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
