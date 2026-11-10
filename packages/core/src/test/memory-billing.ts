import type { MemoryData } from "./memory-store";
import type { Store } from "../services/types";

/** In-memory billing repository (FIN, EXP-04). The billing slice fills this in. */
export function memoryBilling(_data: MemoryData, _uuid: () => string): Pick<Store, "billing"> {
  return { billing: {} };
}
