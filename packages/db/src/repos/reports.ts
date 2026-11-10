import type { ReportRepo } from "@fieldops/core";
import type { Tx } from "../client";

// Service reports (AI-03, FIN-04). The documents slice defines this repository.

export function reportRepo(_tx: Tx, _orgId: string): ReportRepo {
  return {};
}
