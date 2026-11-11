import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { member, organization } from "./auth";

// Release 0.5 (Platform): API keys (PLT-02) and the integration-event outbox delivered by Relay (PLT-03, ADR 008,
// ADR 022). Both are tenant tables (organization_id first in every index, tenant_isolation policy in migration
// 0005), but neither is written directly by the web role: keys are looked up by hash through the SECURITY DEFINER
// function api_key_authenticate(), and outbox rows are written only by the outbox_* triggers.

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

/**
 * API keys. A key acts as the member who created it (so removing the member removes their keys), narrowed by its
 * scopes (`read`, `write`). The secret is never stored: `token_hash` is the SHA-256 hex of the whole key.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: id(),
    organizationId: orgId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The first characters of the key, shown in lists (`fo_8kq2`). */
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{read}'::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_key_token_hash_uq").on(t.tokenHash),
    index("api_key_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

/**
 * Integration events waiting for Relay (§11.4). Written by triggers only while the organization has webhooks
 * turned on (`organization.webhooks_enabled_at`); the worker claims pending rows with SKIP LOCKED, posts them to
 * Relay with the row id as the Idempotency-Key and marks them sent. Sent rows are deleted after 7 days.
 */
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: id(),
    organizationId: orgId(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    /** pending | sending | sent | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** Relay's event id (`evt_…`) once accepted. */
    relayEventId: text("relay_event_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_event_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`status in ('pending', 'sending')`),
    index("outbox_event_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);
