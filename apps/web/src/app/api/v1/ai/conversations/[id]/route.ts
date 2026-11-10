import { assistant } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toConversationDetailDto } from "@/server/api/serialize-assistant";

type Params = { id: string };

/** One of the user's own conversations with its messages; anyone else's is a 404 (AI-02). */
export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  return { body: toConversationDetailDto(await assistant.getConversation(ctx, params.id)) };
});

export const DELETE = apiRoute<Params>(async ({ params, ctx }) => {
  await assistant.deleteConversation(ctx, params.id);
  return { status: 204 };
});
