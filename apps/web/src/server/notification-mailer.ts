import "server-only";
import type { NotificationMailer } from "@fieldops/core";
import type { Tx } from "@fieldops/db";

/**
 * Notification emails (NOT-02): renders the template and writes it to the outbox in the caller's transaction, so
 * the email exists only if the change it reports commits. Implemented by the notifications slice; until then,
 * notifications are in-app only.
 */
export function notificationMailer(_tx: Tx, _organizationId: string): NotificationMailer | undefined {
  return undefined;
}
