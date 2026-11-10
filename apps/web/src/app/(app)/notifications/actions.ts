"use server";
import { notifications } from "@fieldops/core";
import type { NotificationDto, NotificationPreferenceDto } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { toNotificationDto, toPreferenceDto } from "@/server/api/serialize-notifications";
import { action, runService, type ActionResult } from "@/server/context";

/** The latest notifications and the unread count, for the bell (NOT-01). */
export async function recentNotificationsAction(): Promise<
  ActionResult<{ items: NotificationDto[]; unread: number }>
> {
  return action(() =>
    runService(async (ctx) => {
      const [page, unread] = await Promise.all([
        notifications.listNotifications(ctx, { limit: 10 }),
        notifications.countUnread(ctx),
      ]);
      return { items: page.rows.map(toNotificationDto), unread };
    }),
  );
}

export async function markNotificationsReadAction(
  input: { ids: string[] } | { all: true },
): Promise<ActionResult<{ unread: number }>> {
  const result = await action(() =>
    runService(async (ctx) => {
      await notifications.markRead(ctx, input);
      return { unread: await notifications.countUnread(ctx) };
    }),
  );
  if (result.ok) revalidatePath("/notifications");
  return result;
}

export async function savePreferencesAction(input: {
  preferences: { event: string; in_app: boolean | null; email: boolean | null }[];
}): Promise<ActionResult<NotificationPreferenceDto[]>> {
  return action(() =>
    runService(async (ctx) => (await notifications.updatePreferences(ctx, input)).map(toPreferenceDto)),
  );
}
