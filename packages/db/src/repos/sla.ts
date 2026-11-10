import type { SlaPolicyRecord, SlaRepo } from "@fieldops/core";
import type { JobPriority } from "@fieldops/shared";
import { eq } from "drizzle-orm";
import type { Tx } from "../client";
import { slaPolicy } from "../schema";

// SLA policies and the monitor's queries (SLA-01–03). The SLA slice extends this repository.

export function slaRepo(tx: Tx, orgId: string): SlaRepo {
  return {
    async listPolicies(): Promise<SlaPolicyRecord[]> {
      const rows = await tx.select().from(slaPolicy).where(eq(slaPolicy.organizationId, orgId));
      return rows.map((r) => ({
        id: r.id,
        priority: r.priority as JobPriority,
        responseMin: r.responseMin,
        resolutionMin: r.resolutionMin,
        businessHours: r.businessHours,
      }));
    },
  };
}
