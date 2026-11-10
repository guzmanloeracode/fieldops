import type { DigestRepo, RecurrenceRepo } from "@fieldops/core";
import type { Tx } from "../client";

// Maintenance plans (JOB-13) and the owner's daily digest (NOT-04). The ops slice defines these repositories.

export function recurrenceRepo(_tx: Tx, _orgId: string): RecurrenceRepo {
  return {};
}

export function digestRepo(_tx: Tx, _orgId: string): DigestRepo {
  return {};
}
