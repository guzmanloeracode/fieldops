import type { WebhookRepo } from "@fieldops/core";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../client";
import { organization, outboxEvent } from "../schema";

// Outgoing webhooks (PLT-03, ADR 022): whether the organization has them on, and the types of its published
// events. Turning them on or off updates the organization row, which the audit trigger logs.

export function webhookRepo(tx: Tx, orgId: string): WebhookRepo {
  return {
    async state() {
      const [r] = await tx
        .select({ enabledAt: organization.webhooksEnabledAt, name: organization.name })
        .from(organization)
        .where(eq(organization.id, orgId));
      if (!r) throw new Error("Organization not found");
      return r;
    },
    async setEnabled(at) {
      await tx.update(organization).set({ webhooksEnabledAt: at }).where(eq(organization.id, orgId));
    },
    async eventTypes(ids) {
      if (!ids.length) return {};
      const rows = await tx
        .select({ id: outboxEvent.relayEventId, type: outboxEvent.type })
        .from(outboxEvent)
        .where(and(eq(outboxEvent.organizationId, orgId), inArray(outboxEvent.relayEventId, ids)));
      return Object.fromEntries(rows.filter((r) => r.id).map((r) => [r.id!, r.type]));
    },
  };
}
