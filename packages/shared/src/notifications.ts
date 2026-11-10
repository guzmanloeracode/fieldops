import { z } from "zod";
import { NOTIFICATION_EVENTS, SLA_TARGETS, type NotificationEvent, type Role } from "./constants";
import { queryBool, ts } from "./fields";

// Notifications (NOT-01–03). The payload carries what the UI and the email need to describe the event and link
// to it; the text itself is rendered from the event type, so it can be translated (SET-05).

export const notificationEventSchema = z.enum(NOTIFICATION_EVENTS).meta({ id: "NotificationEvent" });

export const notificationPayloadSchema = z
  .object({
    job_id: z.uuid().optional(),
    job_number: z.number().int().optional(),
    job_title: z.string().optional(),
    customer_name: z.string().optional(),
    /** Who caused the event, when it was a person. */
    actor_name: z.string().optional(),
    scheduled_start: z.string().optional(),
    expense_id: z.uuid().optional(),
    item: z.string().optional(),
    decision: z.enum(["approved", "rejected"]).optional(),
    target: z.enum(SLA_TARGETS).optional(),
    due_at: z.string().optional(),
  })
  .meta({ id: "NotificationPayload" });
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

/**
 * The events each role can receive, for the preferences page (NOT-03). Office roles get the operational
 * alerts (small teams often have no dispatcher); technicians get their own work.
 */
export const NOTIFICATION_EVENTS_BY_ROLE: Record<Role, readonly NotificationEvent[]> = {
  owner: ["portal_request", "sla_at_risk", "sla_breached", "expense_requested", "expense_decided"],
  admin: ["portal_request", "sla_at_risk", "sla_breached", "expense_requested", "expense_decided"],
  dispatcher: ["portal_request", "sla_at_risk", "sla_breached", "expense_requested", "expense_decided"],
  technician: ["job_assigned", "job_rescheduled", "expense_decided"],
};

export const notificationListQuerySchema = z.object({
  unread: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type NotificationListQuery = z.output<typeof notificationListQuerySchema>;

export const notificationReadSchema = z
  .union([z.object({ ids: z.array(z.uuid()).min(1).max(200) }), z.object({ all: z.literal(true) })])
  .meta({ id: "NotificationRead", description: "Mark some notifications, or all of them, as read" });
export type NotificationReadInput = z.infer<typeof notificationReadSchema>;

export const notificationSchema = z
  .object({
    id: z.uuid(),
    type: notificationEventSchema,
    payload: notificationPayloadSchema,
    /** Where the notification leads in the app, e.g. "/jobs/JOB-000123". */
    href: z.string(),
    read_at: ts.nullable(),
    created_at: ts,
  })
  .meta({ id: "Notification" });
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationPreferenceSchema = z
  .object({
    event: notificationEventSchema,
    in_app: z.boolean(),
    /** Null when the event has no email. */
    email: z.boolean().nullable(),
  })
  .meta({ id: "NotificationPreference" });
export type NotificationPreferenceDto = z.infer<typeof notificationPreferenceSchema>;

export const notificationPreferencesUpdateSchema = z
  .object({
    preferences: z
      .array(
        z.object({
          event: notificationEventSchema,
          in_app: z.boolean(),
          email: z.boolean().nullable().optional(),
        }),
      )
      .min(1)
      .max(NOTIFICATION_EVENTS.length),
  })
  .meta({ id: "NotificationPreferencesUpdate" });
export type NotificationPreferencesUpdate = z.infer<typeof notificationPreferencesUpdateSchema>;
