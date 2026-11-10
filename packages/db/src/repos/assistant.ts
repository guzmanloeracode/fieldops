import type { AssistantRepo } from "@fieldops/core";
import type { Tx } from "../client";

// Ask FieldOps conversations and its read-only tools (AI-02). The assistant slice defines this repository.

export function assistantRepo(_tx: Tx, _orgId: string): AssistantRepo {
  return {};
}
