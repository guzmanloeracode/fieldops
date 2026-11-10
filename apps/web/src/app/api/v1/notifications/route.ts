import { notifications } from "@fieldops/core";
import { apiRoute, queryObject } from "@/server/api/handler";
import { toNotificationDto } from "@/server/api/serialize-notifications";

/** The signed-in user's notifications, newest first (NOT-01). */
export const GET = apiRoute(async ({ url, ctx }) => {
  const query = { ...queryObject(url), page: undefined };
  const [page, unread] = await Promise.all([
    notifications.listNotifications(ctx, query),
    notifications.countUnread(ctx),
  ]);
  return {
    body: { data: page.rows.map(toNotificationDto), next_cursor: page.nextCursor, unread_count: unread },
  };
});
