import { notifications } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";

/** Marks some or all of the user's notifications as read (NOT-01). */
export const POST = apiRoute(async ({ body, ctx }) => {
  const updated = await notifications.markRead(ctx, body);
  const unread = await notifications.countUnread(ctx);
  return { body: { updated, unread_count: unread } };
});
