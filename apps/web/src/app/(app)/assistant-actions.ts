"use server";
import { assistant } from "@fieldops/core";
import { assistantModel } from "@/server/ai";
import { toConversationDetailDto, toConversationDto } from "@/server/api/serialize-assistant";
import { action, runService } from "@/server/context";

// Ask FieldOps panel (AI-02): whether it can answer, the user's recent conversations, and opening or deleting one.
// Questions themselves go to the streaming endpoint, POST /api/v1/ai/assistant.

export async function assistantStatusAction() {
  return action(() =>
    runService(async (ctx) => {
      const [status, rows] = await Promise.all([
        assistant.assistantStatus(ctx, assistantModel.provider),
        assistant.listConversations(ctx),
      ]);
      return { ...status, conversations: rows.map(toConversationDto) };
    }),
  );
}

export async function assistantConversationAction(id: string) {
  return action(() =>
    runService(async (ctx) => toConversationDetailDto(await assistant.getConversation(ctx, String(id)))),
  );
}

export async function deleteAssistantConversationAction(id: string) {
  return action(() => runService((ctx) => assistant.deleteConversation(ctx, String(id))));
}
