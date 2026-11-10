import { billingPass, type CustomerMailer, type Store } from "@fieldops/core";
import { schema, withStore, type Database } from "@fieldops/db";
import { renderEmail } from "@fieldops/email";
import { env } from "./env";
import { log } from "./log";
import { notificationMailer } from "./mailer";

/**
 * Billing emails to customers from the worker (FIN-06 reminders), written to the outbox in the caller's
 * transaction. In demo mode they are captured instead of sent (DEM-05).
 */
export function customerMailer(store: Store): CustomerMailer {
  return {
    async send({ to, path, ...props }) {
      const rendered = await renderEmail({
        kind: "billing",
        to,
        props: { ...props, url: new URL(path, env.appUrl).toString() },
      });
      await store.billing.queueEmail({
        toEmail: to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        kind: `billing.${props.kind}`,
        captured: env.demoMode,
      });
    },
  };
}

/**
 * The billing pass (FIN-02, FIN-06), every hour: per organization and in its own transaction, expire quotes past
 * their validity, mark unpaid invoices past due as overdue and send the 3/7/14-day reminders. Idempotent; each
 * step uses the organization's local date. See `billingPass.runBillingPass`.
 */
export async function runBillingPasses(db: Database, now = new Date()): Promise<void> {
  const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);
  const totals = { expiredQuotes: 0, overdueInvoices: 0, reminders: 0 };
  for (const org of orgs) {
    try {
      const r = await withStore(db, org.id, (store, tx) =>
        billingPass.runBillingPass({
          store,
          now,
          mailer: notificationMailer(tx, org.id),
          customerMailer: customerMailer(store),
        }),
      );
      totals.expiredQuotes += r.expiredQuotes;
      totals.overdueInvoices += r.overdueInvoices;
      totals.reminders += r.reminders;
    } catch (err) {
      log.error({ err, orgId: org.id }, "billing pass failed for an organization");
    }
  }
  if (totals.expiredQuotes || totals.overdueInvoices || totals.reminders) log.info(totals, "billing pass");
}
