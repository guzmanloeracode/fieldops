import {
  decodeCursor,
  encodeCursor,
  type NotificationPreferenceRecord,
  type NotificationRecord,
  type NotificationRepo,
} from "@fieldops/core";
import type { NotificationEvent, NotificationPayload } from "@fieldops/shared";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { notification, notificationPreference } from "../schema";

// Notifications and preferences (NOT-01–03). Every query is scoped to the organization and one user.

const SORT = "-created_at";

function toRecord(r: typeof notification.$inferSelect): NotificationRecord {
  return {
    id: r.id,
    userId: r.userId,
    type: r.type as NotificationEvent,
    payload: (r.payload ?? {}) as NotificationPayload,
    readAt: r.readAt,
    createdAt: r.createdAt,
  };
}

function toPreference(r: typeof notificationPreference.$inferSelect): NotificationPreferenceRecord {
  return { userId: r.userId, event: r.event as NotificationEvent, inApp: r.inApp, email: r.email };
}

export function notificationRepo(tx: Tx, orgId: string): NotificationRepo {
  const mine = (userId: string) =>
    and(eq(notification.organizationId, orgId), eq(notification.userId, userId));

  return {
    async create(rows) {
      if (rows.length === 0) return;
      await tx
        .insert(notification)
        .values(
          rows.map((r) => ({ organizationId: orgId, userId: r.userId, type: r.type, payload: r.payload })),
        );
    },

    async preferences(userIds, event) {
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
      return rows.map(toPreference);
    },

    async list(f) {
      const where: (SQL | undefined)[] = [mine(f.userId)];
      if (f.unreadOnly) where.push(isNull(notification.readAt));
      if (f.cursor && !f.page) {
        const [at, id] = decodeCursor(f.cursor, SORT).v as [string, string];
        where.push(sql`(${notification.createdAt}, ${notification.id}) < (${at}::timestamptz, ${id}::uuid)`);
      }
      const condition = and(...where);
      const rows = await tx
        .select({
          n: notification,
          // Microsecond precision, so rows created in the same millisecond page correctly.
          at: sql<string>`to_char(${notification.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(notification)
        .where(condition)
        .orderBy(desc(notification.createdAt), desc(notification.id))
        .limit(f.limit + 1)
        .offset(f.page ? (f.page - 1) * f.limit : 0);
      const hasMore = rows.length > f.limit;
      const page = rows.slice(0, f.limit);
      const last = page.at(-1);
      let total: number | null = null;
      if (f.page) {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(notification)
          .where(condition);
        total = t?.n ?? 0;
      }
      return {
        rows: page.map((r) => toRecord(r.n)),
        nextCursor: hasMore && last && !f.page ? encodeCursor({ s: SORT, v: [last.at, last.n.id] }) : null,
        total,
      };
    },

    async unreadCount(userId) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(notification)
        .where(and(mine(userId), isNull(notification.readAt)));
      return r?.n ?? 0;
    },

    async markRead(userId, ids, at) {
      if (ids !== "all" && ids.length === 0) return 0;
      const r = await tx
        .update(notification)
        .set({ readAt: at })
        .where(
          and(
            mine(userId),
            isNull(notification.readAt),
            ids === "all" ? undefined : inArray(notification.id, ids),
          ),
        );
      return r.rowCount ?? 0;
    },

    async userPreferences(userId) {
      const rows = await tx
        .select()
        .from(notificationPreference)
        .where(
          and(eq(notificationPreference.organizationId, orgId), eq(notificationPreference.userId, userId)),
        );
      return rows.map(toPreference);
    },

    async savePreferences(userId, prefs) {
      if (prefs.length === 0) return;
      await tx
        .insert(notificationPreference)
        .values(
          prefs.map((p) => ({
            organizationId: orgId,
            userId,
            event: p.event,
            inApp: p.inApp,
            email: p.email,
          })),
        )
        .onConflictDoUpdate({
          target: [
            notificationPreference.organizationId,
            notificationPreference.userId,
            notificationPreference.event,
          ],
          set: { inApp: sql`excluded.in_app`, email: sql`excluded.email`, updatedAt: new Date() },
        });
    },
  };
}
