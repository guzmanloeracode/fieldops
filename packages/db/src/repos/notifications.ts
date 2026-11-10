import type { NotificationPreferenceRecord, NotificationRepo } from "@fieldops/core";
import type { NotificationEvent } from "@fieldops/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../client";
import { notification, notificationPreference } from "../schema";

// Notifications and preferences (NOT-01–03). The notifications slice extends this repository.

export function notificationRepo(tx: Tx, orgId: string): NotificationRepo {
  return {
    async create(rows) {
      if (rows.length === 0) return;
      await tx
        .insert(notification)
        .values(
          rows.map((r) => ({ organizationId: orgId, userId: r.userId, type: r.type, payload: r.payload })),
        );
    },

    async preferences(userIds, event): Promise<NotificationPreferenceRecord[]> {
      if (userIds.length === 0) return [];
      const rows = await tx
        .select()
        .from(notificationPreference)
        .where(
          and(
            eq(notificationPreference.organizationId, orgId),
            inArray(notificationPreference.userId, userIds),
            eq(notificationPreference.event, event),
          ),
        );
      return rows.map((r) => ({
        userId: r.userId,
        event: r.event as NotificationEvent,
        inApp: r.inApp,
        email: r.email,
      }));
    },
  };
}
