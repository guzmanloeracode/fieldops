import { digest, formatJobNumber, formatMoney, recurrences, type DigestMailer } from "@fieldops/core";
import { schema, withStore, type Database, type Tx } from "@fieldops/db";
import { renderEmail } from "@fieldops/email";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { env } from "./env";
import { log } from "./log";

// Maintenance plans (JOB-13) and the owner's daily digest (NOT-04). Both run hourly: organizations start their
// day (and reach 07:00) at different UTC hours, and both passes do nothing when nothing is due. Each organization
// runs in its own transaction, so a failure in one doesn't hold back the others.

const link = (path: string) => new URL(path, env.appUrl).toString();

/** Writes the digest email to the outbox in the caller's transaction; captured instead of sent in the demo. */
export function digestMailer(tx: Tx, organizationId: string): DigestMailer {
  let org: { name: string } | undefined;
  return {
    async send({ recipient, summary }) {
      org ??= (
        await tx
          .select({ name: schema.organization.name })
          .from(schema.organization)
          .where(eq(schema.organization.id, organizationId))
      )[0];
      if (!org) return;
      const money = (amountMinor: number) => formatMoney({ amountMinor, currency: summary.currency });
      const rendered = await renderEmail({
        kind: "daily_digest",
        to: recipient.email,
        props: {
          recipientName: recipient.name,
          organizationName: org.name,
          date: summary.date,
          figures: {
            jobsCreated: summary.jobsCreated,
            jobsCompleted: summary.jobsCompleted,
            slaMet: summary.slaMet,
            slaMeasured: summary.slaMeasured,
            firstVisit: summary.firstVisit,
            invoiced: money(summary.invoicedMinor),
            collected: money(summary.collectedMinor),
          },
          overdue: summary.overdue.map((j) => ({
            label: formatJobNumber(j.number),
            title: j.title,
            customerName: j.customerName,
            url: link(`/jobs/${formatJobNumber(j.number)}`),
          })),
          overdueCount: summary.overdueCount,
          pendingApprovals: summary.pendingApprovals,
          urls: {
            dashboard: link("/dashboard"),
            overdue: link("/jobs?sla=breached&status=new,scheduled,en_route,in_progress,on_hold"),
            approvals: link("/approvals"),
            preferences: link("/notifications/preferences"),
          },
        },
      });
      await tx.insert(schema.emailOutbox).values({
        organizationId,
        toEmail: recipient.email.toLowerCase(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        kind: "notification.daily_digest",
        status: env.demoMode ? "captured" : "queued",
      });
    },
  };
}

async function eachOrganization(db: Database, task: string, fn: (orgId: string) => Promise<number>) {
  const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);
  let total = 0;
  for (const org of orgs) {
    try {
      total += await fn(org.id);
    } catch (err) {
      log.error({ err, orgId: org.id }, `${task} failed for an organization`);
    }
  }
  if (total) log.info({ n: total }, task);
}

/** Creates the jobs of every maintenance plan due within its lead days. Idempotent. */
export function runRecurrences(db: Database, now = new Date()) {
  return eachOrganization(db, "recurring jobs generated", (orgId) =>
    withStore(db, orgId, (store) => recurrences.generateDue({ store, now })),
  );
}

/** Sends the digest of organizations where it is 07:00, once per recipient and local date. */
export function runDigests(db: Database, now = new Date()) {
  return eachOrganization(db, "daily digests sent", (orgId) =>
    withStore(db, orgId, (store, tx) =>
      digest.sendDailyDigests({ store, mailer: digestMailer(tx, orgId), now }),
    ),
  );
}

/** Schedules both passes on pg-boss. */
export async function scheduleOps(boss: PgBoss, db: Database) {
  await boss.createQueue("recurrences");
  await boss.schedule("recurrences", "10 * * * *", {}, { tz: "UTC" });
  await boss.work("recurrences", async () => runRecurrences(db));
  await boss.createQueue("daily-digest");
  await boss.schedule("daily-digest", "2 * * * *", {}, { tz: "UTC" });
  await boss.work("daily-digest", async () => runDigests(db));
}
