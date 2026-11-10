import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { job, contact, customer } from "./app";
import { organization, user } from "./auth";

// Release 0.3 (Automate): SLA policies and alerts, notifications, the audit log, the customer portal, AI usage
// and rate limits. Tenant tables follow the same rules as app.ts: organization_id on every row, every index
// led by it, and the tenant_isolation policy (migration 0003).

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Response and resolution targets per priority (SLA-01). One row per priority; missing rows use the defaults. */
export const slaPolicy = pgTable(
  "sla_policy",
  {
    id: id(),
    organizationId: orgId(),
    priority: text("priority").notNull(),
    /** Minutes from creation until the job must be scheduled with a technician. */
    responseMin: integer("response_min").notNull(),
    /** Minutes from creation until the job must be completed. */
    resolutionMin: integer("resolution_min").notNull(),
    /** Count only the organization's business hours instead of calendar time. */
    businessHours: boolean("business_hours").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sla_policy_org_priority_uq").on(t.organizationId, t.priority)],
);

/**
 * One row per job, target and alert kind: the SLA monitor inserts with ON CONFLICT DO NOTHING and only notifies
 * for rows it actually inserted, so `sla.at_risk` and `sla.breached` are raised once per job and target (SLA-03).
 */
export const slaAlert = pgTable(
  "sla_alert",
  {
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    /** response | resolution */
    target: text("target").notNull(),
    /** at_risk | breached */
    kind: text("kind").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.jobId, t.target, t.kind] }),
    index("sla_alert_org_raised_idx").on(t.organizationId, t.raisedAt),
  ],
);

/** In-app notifications (NOT-01). Inserting a row publishes a live event to the recipient (NOT-05). */
export const notification = pgTable(
  "notification",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notification_org_user_idx").on(t.organizationId, t.userId, t.createdAt),
    index("notification_org_user_unread_idx")
      .on(t.organizationId, t.userId)
      .where(sql`read_at is null`),
  ],
);

/** Per-user channel choices per event (NOT-03). Missing rows follow the defaults in @fieldops/shared. */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    organizationId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId, t.event] })],
);

/**
 * Append-only audit log (AUD-01). Rows are written by the `audit_row()` trigger in the same transaction as the
 * change (AUD-02), with the actor, IP address and user agent taken from transaction-local settings. The runtime
 * role may insert and read, never update or delete.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: orgId(),
    /** Null for system changes (worker, migrations). */
    actorUserId: uuid("actor_user_id"),
    /** e.g. "job.update", "member.update", "auth.sign_in". */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** Changed columns only for updates; the whole row for inserts (after) and deletes (before). */
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_log_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    index("audit_log_org_actor_idx").on(t.organizationId, t.actorUserId, t.createdAt),
  ],
);

/** One-time sign-in links for the customer portal (POR-01). Only the SHA-256 of the token is stored. */
export const portalToken = pgTable(
  "portal_token",
  {
    id: id(),
    organizationId: orgId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("portal_token_org_hash_uq").on(t.organizationId, t.tokenHash),
    index("portal_token_org_contact_idx").on(t.organizationId, t.contactId),
  ],
);

/** Signed-in portal customers. The cookie holds a random token; only its SHA-256 is stored. */
export const portalSession = pgTable(
  "portal_session",
  {
    id: id(),
    organizationId: orgId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("portal_session_org_hash_uq").on(t.organizationId, t.tokenHash),
    index("portal_session_org_contact_idx").on(t.organizationId, t.contactId),
  ],
);

/** One row per AI call (§9.7 usage logging). `output` keeps the validated draft for review. */
export const aiInteraction = pgTable(
  "ai_interaction",
  {
    id: id(),
    organizationId: orgId(),
    /** Null for portal requests drafted by the worker. */
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => job.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    stopReason: text("stop_reason"),
    /** drafted | accepted | edited | discarded | refused | failed */
    outcome: text("outcome").notNull(),
    output: jsonb("output"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ai_interaction_org_created_idx").on(t.organizationId, t.createdAt),
    index("ai_interaction_org_job_idx").on(t.organizationId, t.jobId),
  ],
);

/**
 * Fixed-window counters for rate limits (PLT-04). Not tenant-scoped: keys name their own scope, e.g.
 * "ai:user:<id>" or "portal:ip:<addr>". Old windows are deleted by the worker's maintenance job.
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
