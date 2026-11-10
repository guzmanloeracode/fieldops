import "server-only";
import { renderEmail, type EmailMessage } from "@fieldops/email";
import { schema } from "@fieldops/db";
import { env } from "@/env";
import { db } from "./db";

/**
 * Writes the email to the outbox; the worker sends it. In the public demo it is stored as "captured" and
 * shown in the Demo inbox instead of being sent (DEM-05).
 */
export async function queueEmail(message: EmailMessage, organizationId?: string | null) {
  const rendered = await renderEmail(message);
  await db.insert(schema.emailOutbox).values({
    organizationId: organizationId ?? null,
    toEmail: message.to.toLowerCase(),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: message.kind,
    status: env.DEMO_MODE ? "captured" : "queued",
  });
}
