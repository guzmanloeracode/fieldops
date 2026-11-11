import { z } from "zod";

// Audit log viewer (AUD-03). Entries are written by the audit_row() trigger and audit_event() (ADR 016).

/** Entity types in the log: the audited tables, plus "user" for sign-ins. */
export const AUDIT_ENTITY_TYPES = [
  "job",
  "job_assignment",
  "checklist_item",
  "note",
  "attachment",
  "time_entry",
  "expense_request",
  "customer",
  "contact",
  "site",
  "equipment",
  "service_type",
  "sla_policy",
  "time_off",
  "member",
  "invitation",
  "organization",
  "user",
  // 0.5: webhook endpoints live in Relay; their changes are logged with audit_event().
  "webhook_endpoint",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** The operation part of an action ("job.update" → "update"). */
export const AUDIT_OPERATIONS = ["insert", "update", "delete", "sign_in", "sign_out"] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const auditListQuerySchema = z.object({
  actor: z.preprocess(blankToUndefined, z.union([z.uuid(), z.literal("system")]).optional()),
  entity_type: z.preprocess(blankToUndefined, z.enum(AUDIT_ENTITY_TYPES).optional()),
  operation: z.preprocess(blankToUndefined, z.enum(AUDIT_OPERATIONS).optional()),
  entity_id: z.preprocess(blankToUndefined, z.string().trim().max(64).optional()),
  /** Dates in the organization's time zone, inclusive. */
  from: z.preprocess(blankToUndefined, localDate.optional()),
  to: z.preprocess(blankToUndefined, localDate.optional()),
  cursor: z.preprocess(blankToUndefined, z.string().max(200).optional()),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditListQuery = z.output<typeof auditListQuerySchema>;
