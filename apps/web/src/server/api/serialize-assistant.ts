import type { AssistantConversationRecord, AssistantMessageRecord } from "@fieldops/core";
import type {
  AssistantConversationDetailDto,
  AssistantConversationDto,
  AssistantMessageDto,
} from "@fieldops/shared";

/** Ask FieldOps conversations in the API's snake_case shape (AI-02). */
export function toConversationDto(c: AssistantConversationRecord): AssistantConversationDto {
  return {
    id: c.id,
    title: c.title,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

export function toAssistantMessageDto(m: AssistantMessageRecord): AssistantMessageDto {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    tools: m.tools,
    created_at: m.createdAt.toISOString(),
  };
}

export function toConversationDetailDto(d: {
  conversation: AssistantConversationRecord;
  messages: AssistantMessageRecord[];
}): AssistantConversationDetailDto {
  return { ...toConversationDto(d.conversation), messages: d.messages.map(toAssistantMessageDto) };
}
