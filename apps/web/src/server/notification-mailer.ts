import "server-only";
import { notifications, type NotificationMailer } from "@fieldops/core";
import { schema, type Tx } from "@fieldops/db";
import { renderEmail } from "@fieldops/email";
import { eq } from "drizzle-orm";
import { env } from "@/env";

/**
 * Notification emails (NOT-02): renders the template and writes it to the outbox in the caller's transaction, so
 * the email exists only if the change it reports commits. In the public demo it is stored as "captured" and shows
 * in the Demo outbox instead of being sent (DEM-05).
 */
export function notificationMailer(tx: Tx, organizationId: string): NotificationMailer {
  let org: { name: string; timezone: string } | undefined;
  return {
    async send({ userId, event, payload }) {
      const [recipient] = await tx
        .select({ name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, userId));
      if (!recipient) return;
      org ??= (
        await tx
          .select({ name: schema.organization.name, timezone: schema.organization.timezone })
          .from(schema.organization)
          .where(eq(schema.organization.id, organizationId))
      )[0];
      if (!org) return;
      const rendered = await renderEmail({
        kind: "notification",
        to: recipient.email,
        props: {
          event,
          payload,
          recipientName: recipient.name,
          organizationName: org.name,
          url: new URL(notifications.notificationHref(event, payload), env.APP_URL).toString(),
          preferencesUrl: new URL("/notifications/preferences", env.APP_URL).toString(),
          timeZone: org.timezone,
        },
      });
      await tx.insert(schema.emailOutbox).values({
        organizationId,
        toEmail: recipient.email.toLowerCase(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        kind: `notification.${event}`,
        status: env.DEMO_MODE ? "captured" : "queued",
      });
    },
  };
}
