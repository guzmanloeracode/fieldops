import type { PortalRepo } from "@fieldops/core";
import type { Tx } from "../client";

// Customer portal (POR-01–03). The portal slice defines this repository.

export function portalRepo(_tx: Tx, _orgId: string): PortalRepo {
  return {};
}
