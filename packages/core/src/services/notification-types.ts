import type { NotificationEvent, NotificationPayload } from "@fieldops/shared";

// Notifications (NOT-01–03, NOT-05). The notifications slice extends these contracts.

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationEvent;
  payload: NotificationPayload;
  readAt: Date | null;
  createdAt: Date;
}

/** A user's stored choice for one event. Missing rows follow NOTIFICATION_DEFAULTS. */
export interface NotificationPreferenceRecord {
  userId: string;
  event: NotificationEvent;
  inApp: boolean;
  email: boolean;
}

export interface NotificationRepo {
  /** Inserts in-app notifications. Each insert publishes a live event to its recipient (database trigger). */
  create(rows: { userId: string; type: NotificationEvent; payload: NotificationPayload }[]): Promise<void>;
  /** Stored preferences of these users for one event. */
  preferences(userIds: string[], event: NotificationEvent): Promise<NotificationPreferenceRecord[]>;
}

/** Writes a notification email to the outbox in the caller's transaction (NOT-02). Implemented by web and worker. */
export interface NotificationMailer {
  send(input: { userId: string; event: NotificationEvent; payload: NotificationPayload }): Promise<void>;
}
