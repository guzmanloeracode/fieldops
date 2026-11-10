import { z } from "zod";
import { NOTIFICATION_EVENTS, SLA_TARGETS } from "./constants";

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
