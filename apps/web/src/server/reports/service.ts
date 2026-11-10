import "server-only";
import { createReportModel } from "@fieldops/ai";
import type { ReportEmail, ReportModel, ReportSendDeps, ServiceContext } from "@fieldops/core";
import { schema, withStore, type Tx } from "@fieldops/db";
import { renderEmail } from "@fieldops/email";
import { env } from "@/env";
import { requireActor, type ResolvedActor } from "@/server/context";
import { db } from "@/server/db";
import { files } from "@/server/files";
import { notificationMailer } from "@/server/notification-mailer";
import { auditMeta, requestMeta } from "@/server/request-meta";
import { reportLinkUrl } from "./link";

// Service reports in the web app (AI-03): the report writer chosen from the environment, the "Job completed"
// email written to the outbox in the sending transaction, and the signed download link.

export const reportModel: ReportModel = createReportModel({
  apiKey: env.ANTHROPIC_API_KEY,
  provider: env.AI_PROVIDER,
  reportModel: env.AI_MODEL_REPORT,
});

/** Writes the customer's email to the outbox in the caller's transaction (captured in the demo, DEM-05). */
export function reportSendDeps(tx: Tx, organizationId: string): ReportSendDeps {
  return {
    linkFor: reportLinkUrl,
    async sendEmail(email: ReportEmail) {
      const rendered = await renderEmail({
        kind: "report.job_completed",
        to: email.to,
        props: {
          locale: email.locale,
          contactName: email.contactName,
          organizationName: email.organizationName,
          jobNumber: email.jobNumber,
          jobTitle: email.jobTitle,
          completedOn: email.completedOn,
          url: email.url,
          expiresOn: email.expiresAt.toISOString().slice(0, 10),
        },
      });
      await tx.insert(schema.emailOutbox).values({
        organizationId,
        toEmail: email.to.toLowerCase(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        kind: "report.job_completed",
        status: env.DEMO_MODE ? "captured" : "queued",
      });
    },
  };
}

/** Like runService, with the transaction for writing the email in it. */
export async function runWithTx<T>(
  fn: (ctx: ServiceContext, tx: Tx) => Promise<T>,
  actor?: ResolvedActor,
): Promise<T> {
  const a = actor ?? (await requireActor());
  const meta = auditMeta(await requestMeta());
  return withStore(
    db,
    a.organizationId,
    (store, tx) =>
      fn(
        {
          actor: a,
          store,
          now: new Date(),
          demo: env.DEMO_MODE,
          files,
          mailer: notificationMailer(tx, a.organizationId),
        },
        tx,
      ),
    { userId: a.userId, ip: meta.ip, userAgent: meta.userAgent },
  );
}
