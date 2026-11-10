import type { MemoryData } from "./memory-store";
import type { Store } from "../services/types";

/** In-memory assistant conversations (AI-02). The assistant slice fills this in. */
export function memoryAssistant(_data: MemoryData, _uuid: () => string): Pick<Store, "assistant"> {
  return { assistant: {} };
}
