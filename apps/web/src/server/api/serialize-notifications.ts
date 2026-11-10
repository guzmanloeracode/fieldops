import "server-only";
import { notifications, type NotificationRecord } from "@fieldops/core";
import type { NotificationDto, NotificationPreferenceDto } from "@fieldops/shared";

export function toNotificationDto(n: NotificationRecord): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    payload: n.payload,
    href: notifications.notificationHref(n.type, n.payload),
    read_at: n.readAt?.toISOString() ?? null,
    created_at: n.createdAt.toISOString(),
  };
}

export function toPreferenceDto(p: notifications.PreferenceRow): NotificationPreferenceDto {
  return { event: p.event, in_app: p.inApp, email: p.email };
}
