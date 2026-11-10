import { assistant } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toConversationDto } from "@/server/api/serialize-assistant";

/** The signed-in user's Ask FieldOps conversations of the last 30 days, most recent first (AI-02). */
export const GET = apiRoute(async ({ ctx }) => {
  const rows = await assistant.listConversations(ctx);
  return { body: { data: rows.map(toConversationDto) } };
});
