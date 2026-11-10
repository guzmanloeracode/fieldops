import { sla } from "@fieldops/core";
import { schema, withStore, type Database } from "@fieldops/db";
import { log } from "./log";
import { notificationMailer } from "./mailer";

/**
 * The SLA monitor (SLA-03), every 5 minutes: one pass per organization, each in its own transaction, so a
 * failure in one organization doesn't hold back the others. Idempotent; see `sla.monitorSla`.
 */
export async function runSlaMonitor(db: Database, now = new Date()): Promise<void> {
  const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);
  let updated = 0;
  let alerts = 0;
  for (const org of orgs) {
    try {
      const r = await withStore(db, org.id, (store, tx) =>
        sla.monitorSla({ store, mailer: notificationMailer(tx, org.id), now }),
      );
      updated += r.updated;
      alerts += r.alerts;
    } catch (err) {
      log.error({ err, orgId: org.id }, "sla monitor failed for an organization");
    }
  }
  if (updated || alerts) log.info({ updated, alerts }, "sla monitor");
}
