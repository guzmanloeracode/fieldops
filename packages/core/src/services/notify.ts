import {
  NOTIFICATION_DEFAULTS,
  type NotificationEvent,
  type NotificationPayload,
  type Role,
} from "@fieldops/shared";
import type { NotificationMailer } from "./notification-types";
import type { Store } from "./types";

export interface NotifyInput {
  event: NotificationEvent;
  userIds: string[];
  payload: NotificationPayload;
  /** The person who caused the event isn't notified about it. */
  exceptUserId?: string | null;
}

/**
 * Notifies users about an event (NOT-01, NOT-02), in the caller's transaction: an in-app notification and, where
 * the event has one, an email, each unless the user turned that channel off (NOT-03). Returns the number of
 * in-app notifications created.
 */
export async function notify(
  deps: { store: Store; mailer?: NotificationMailer },
  input: NotifyInput,
): Promise<number> {
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.exceptUserId);
  if (recipients.length === 0) return 0;
  const defaults = NOTIFICATION_DEFAULTS[input.event];
  const stored = new Map(
    (await deps.store.notifications.preferences(recipients, input.event)).map((p) => [p.userId, p]),
  );
  const inApp =
    defaults.inApp === null ? [] : recipients.filter((id) => stored.get(id)?.inApp ?? defaults.inApp);
  if (inApp.length > 0) {
    await deps.store.notifications.create(
      inApp.map((userId) => ({ userId, type: input.event, payload: input.payload })),
    );
  }
  if (defaults.email !== null && deps.mailer) {
    for (const userId of recipients) {
      if (stored.get(userId)?.email ?? defaults.email) {
        await deps.mailer.send({ userId, event: input.event, payload: input.payload });
      }
    }
  }
  return inApp.length;
}

/** User ids of the organization's members with these roles, e.g. every dispatcher for an SLA alert. */
export async function usersWithRoles(store: Store, roles: readonly Role[]): Promise<string[]> {
  return (await store.members.list()).filter((m) => roles.includes(m.role)).map((m) => m.userId);
}
