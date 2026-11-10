import { notifications } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toPreferenceDto } from "@/server/api/serialize-notifications";

/** The user's channel choices per event (NOT-03). */
export const GET = apiRoute(async ({ ctx }) => {
  const prefs = await notifications.getPreferences(ctx);
  return { body: { data: prefs.map(toPreferenceDto) } };
});

export const PUT = apiRoute(async ({ body, ctx }) => {
  const prefs = await notifications.updatePreferences(ctx, body);
  return { body: { data: prefs.map(toPreferenceDto) } };
});
