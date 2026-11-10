import type { MemoryData } from "./memory-store";
import type { Store } from "../services/types";

/** In-memory service reports (AI-03). The documents slice fills this in. */
export function memoryReports(_data: MemoryData, _uuid: () => string): Pick<Store, "reports"> {
  return { reports: {} };
}
