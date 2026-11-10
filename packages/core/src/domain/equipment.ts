import { addDays } from "./date-range";

export type WarrantyStatus = "active" | "expiring" | "expired" | "unknown";

/** Warranty state on a local date; "expiring" within 60 days of the end date (CUS-03). */
export function warrantyStatus(warrantyEnd: string | null, today: string): WarrantyStatus {
  if (!warrantyEnd) return "unknown";
  if (warrantyEnd < today) return "expired";
  return warrantyEnd <= addDays(today, 60) ? "expiring" : "active";
}
