import type { MemoryData } from "./memory-store";
import type { Store } from "../services/types";

/** In-memory maintenance plans (JOB-13) and digests (NOT-04). The ops slice fills this in. */
export function memoryOps(_data: MemoryData, _uuid: () => string): Pick<Store, "recurrences" | "digest"> {
  return { recurrences: {}, digest: {} };
}
