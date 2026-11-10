import type { BillingRepo } from "@fieldops/core";
import type { Tx } from "../client";

// Catalog, quotes, invoices, payments and reminders (FIN-01–07, EXP-04). The billing slice defines this repository.

export function billingRepo(_tx: Tx, _orgId: string): BillingRepo {
  return {};
}
