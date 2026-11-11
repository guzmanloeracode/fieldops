import { z } from "zod";
import { optionalText, trimmed } from "./fields";

// Release 0.5 (Platform): API keys (PLT-02), rate limits (PLT-04), outgoing webhooks delivered by Relay (PLT-03,
// §11.4) and the MCP server (PLT-05, AI-05). Inputs and API representations use snake_case like the rest of /api/v1.

// ------------------------------------------------------------------ API keys (PLT-02)

/**
 * What a key may do. `read` reaches every GET in /api/v1 and the MCP server; `write` adds POST, PUT, PATCH and
 * DELETE and implies `read`. A key always acts as the member who created it, within that member's role, so a scope
 * can only narrow what the member could do. Keys never manage keys: /api-keys needs a signed-in session.
 */
export const API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** `fo_` + 40 base62 characters (about 238 random bits). Only the SHA-256 hash is stored. */
export const API_KEY_PREFIX = "fo_";
export const API_KEY_PATTERN = /^fo_[0-9A-Za-z]{40}$/;
/** Characters shown in lists so people can tell keys apart, e.g. `fo_8kq2…`. */
export const API_KEY_VISIBLE_CHARS = 7;
/** Active (not revoked, not expired) keys per organization. */
export const MAX_API_KEYS_PER_ORG = 20;
export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const;

export const apiKeyCreateSchema = z
  .object({
    name: trimmed(80).min(1),
    scopes: z
      .array(z.enum(API_KEY_SCOPES))
      .min(1)
      .max(API_KEY_SCOPES.length)
      .transform((s) => [...new Set(s)]),
    expires_in_days: z
      .union([z.literal(30), z.literal(90), z.literal(365)])
      .nullable()
      .optional()
      .meta({ description: "30, 90 or 365; null or missing for a key that doesn't expire" }),
  })
  .meta({ id: "ApiKeyCreate" });
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

/** What lists show. The secret itself is only in the create response (`ApiKeyCreated.key`). */
export interface ApiKeyRepr {
  id: string;
  name: string;
  /** The first characters of the key, e.g. `fo_8kq2`. */
  prefix: string;
  scopes: ApiKeyScope[];
  created_by: { member_id: string; name: string } | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

// ------------------------------------------------------------------ Rate limits (PLT-04)

/** Default requests per minute on /api/v1, overridable by environment variables. */
export const API_RATE_LIMIT_PER_KEY = 300;
export const API_RATE_LIMIT_PER_USER = 600;

// ------------------------------------------------------------------ Webhooks (PLT-03, §17.3)

/**
 * Events FieldOps publishes. They are thin: `data` names the record and its key fields, and a receiver that needs
 * more fetches it from /api/v1 with an API key. Written by database triggers in the same transaction as the change
 * (outbox_event), so an event exists exactly when the change committed.
 */
export const WEBHOOK_EVENT_TYPES = [
  "job.created",
  "job.updated",
  "job.status_changed",
  "job.assigned",
  "job.completed",
  "sla.at_risk",
  "sla.breached",
  "quote.sent",
  "quote.approved",
  "quote.declined",
  "invoice.sent",
  "invoice.paid",
  "expense.decided",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Sent by "Send test event"; only ever delivered to the endpoint it was sent to. */
export const WEBHOOK_TEST_EVENT = "webhook.test";
/** Endpoints per organization. */
export const MAX_WEBHOOK_ENDPOINTS_PER_ORG = 10;

const eventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES).meta({ id: "WebhookEventType" });
const eventTypesSchema = z
  .array(z.union([eventTypeSchema, z.literal("*")]))
  .min(1)
  .max(WEBHOOK_EVENT_TYPES.length + 1)
  .transform((types) => (types.includes("*") ? (["*"] as const) : [...new Set(types)]))
  .meta({ description: 'Event types to receive, or ["*"] for all of them' });

const webhookUrl = z
  .url({ protocol: /^https$/, hostname: z.regexes.domain })
  .max(2000)
  .meta({ description: "An https URL on a public host name", example: "https://example.com/hooks/fieldops" });

export const webhookEndpointCreateSchema = z
  .object({
    url: webhookUrl,
    description: optionalText(200),
    event_types: eventTypesSchema,
  })
  .meta({ id: "WebhookEndpointCreate" });
export type WebhookEndpointCreateInput = z.infer<typeof webhookEndpointCreateSchema>;

export const webhookEndpointUpdateSchema = z
  .object({
    url: webhookUrl.optional(),
    description: optionalText(200),
    event_types: eventTypesSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .meta({ id: "WebhookEndpointUpdate" });
export type WebhookEndpointUpdateInput = z.infer<typeof webhookEndpointUpdateSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed", "dead"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export interface WebhookEndpointRepr {
  id: string;
  url: string;
  description: string | null;
  event_types: (WebhookEventType | "*")[];
  enabled: boolean;
  /** Why Relay turned it off, e.g. after 24 hours of failures or a 410 Gone. */
  disabled_reason: string | null;
  created_at: string;
}

export interface WebhookAttemptRepr {
  attempted_at: string;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
  /** The first kilobyte of the receiver's answer. */
  response_excerpt: string | null;
}

export interface WebhookDeliveryRepr {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  created_at: string;
  delivered_at: string | null;
}

/** The body every webhook carries (Relay's envelope; `tenant` is the organization ID). */
export interface WebhookEnvelope<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType | typeof WEBHOOK_TEST_EVENT;
  tenant: string;
  created_at: string;
  data: T;
}

// ------------------------------------------------------------------ MCP (PLT-05, AI-05)

/** The MCP endpoint, Streamable HTTP, authenticated with an API key that has the `read` scope. */
export const MCP_PATH = "/api/mcp";
