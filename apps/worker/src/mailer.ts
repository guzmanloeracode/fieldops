import type { NotificationMailer } from "@fieldops/core";
import type { Tx } from "@fieldops/db";

/**
 * Notification emails from the worker (SLA alerts), written to the outbox in the caller's transaction (NOT-02).
 * Implemented by the notifications slice; until then the worker's notifications are in-app only.
 */
export function notificationMailer(_tx: Tx, _organizationId: string): NotificationMailer | undefined {
  return undefined;
}
