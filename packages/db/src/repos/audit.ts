import type { AuditRepo } from "@fieldops/core";
import { sql } from "drizzle-orm";
import type { Tx } from "../client";

// Audit log (AUD-01–03). Row changes are logged by the audit_row() trigger (ADR 016). The runtime role can't
// insert into audit_log directly, so events that aren't row changes go through audit_event(), which takes the
// organization, actor, IP address and user agent from the transaction settings. The audit slice extends this.

export function auditRepo(tx: Tx, _orgId: string): AuditRepo {
  return {
    async record(entry) {
      await tx.execute(
        sql`select audit_event(${entry.action}, ${entry.entityType}, ${entry.entityId}, ${
          entry.after ? JSON.stringify(entry.after) : null
        }::jsonb)`,
      );
    },
  };
}
