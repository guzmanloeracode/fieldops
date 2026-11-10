import { notifications, type NotificationMailer } from "@fieldops/core";
import { schema, type Tx } from "@fieldops/db";
import { renderEmail } from "@fieldops/email";
import { eq } from "drizzle-orm";
import { env } from "./env";

/**
 * Notification emails from the worker (SLA alerts), written to the outbox in the caller's transaction (NOT-02).
 * The outbox loop sends them; in demo mode they are captured instead (DEM-05).
 */
export function notificationMailer(tx: Tx, organizationId: string): NotificationMailer {
  let org: { name: string; timezone: string } | undefined;
  return {
    async send({ userId, event, payload }) {
      const [recipient] = await tx
        .select({ name: schema.user.name, email: schema.user.email, locale: schema.user.locale })
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
        // In the recipient's language (SET-05).
        locale: recipient.locale,
        props: {
          event,
          payload,
          recipientName: recipient.name,
          organizationName: org.name,
          url: new URL(notifications.notificationHref(event, payload), env.appUrl).toString(),
          preferencesUrl: new URL("/notifications/preferences", env.appUrl).toString(),
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
        status: env.demoMode ? "captured" : "queued",
      });
    },
  };
}
