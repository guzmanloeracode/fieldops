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

const iso = z.iso.datetime();

/** The API representation of a key (`ApiKeyRepr`), for the OpenAPI document. */
export const apiKeySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    prefix: z.string().meta({ description: "The first characters of the key", example: "fo_8kq2" }),
    scopes: z.array(z.enum(API_KEY_SCOPES)),
    created_by: z
      .object({ member_id: z.uuid(), name: z.string() })
      .nullable()
      .meta({ description: "The member the key acts as" }),
    created_at: iso,
    last_used_at: iso.nullable().meta({ description: "Recorded at most once a minute" }),
    expires_at: iso.nullable(),
    revoked_at: iso.nullable(),
  })
  .meta({ id: "ApiKey" });

export const apiKeyCreatedSchema = apiKeySchema
  .extend({
    key: z.string().meta({
      description: "The secret. Shown only in this response: store it now.",
      example: "fo_8kq2Vd0mXz3nB7cLwP1rT5yH9sJ4eA6gU2oQkF8i",
    }),
  })
  .meta({ id: "ApiKeyCreated" });

// ------------------------------------------------------------------ Rate limits (PLT-04)

/** Default requests per minute on /api/v1, overridable by environment variables. */
export const API_RATE_LIMIT_PER_KEY = 300;
export const API_RATE_LIMIT_PER_USER = 600;

// ------------------------------------------------------------------ Webhooks (PLT-03, §17.3, ADR 022)

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

/** The resource part of each event type, for grouping in the UI and the docs. */
export const WEBHOOK_EVENT_GROUPS = ["job", "sla", "quote", "invoice", "expense"] as const;
export type WebhookEventGroup = (typeof WEBHOOK_EVENT_GROUPS)[number];

/** Sent by "Send test event"; only ever delivered to the endpoint it was sent to. */
export const WEBHOOK_TEST_EVENT = "webhook.test";
/** Endpoints per organization. */
export const MAX_WEBHOOK_ENDPOINTS_PER_ORG = 10;
/** Receivers should reject a `webhook-timestamp` further than this from their clock. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const eventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES).meta({ id: "WebhookEventType" });
const eventTypesSchema = z
  .array(z.union([eventTypeSchema, z.literal("*")]))
  .min(1)
  .max(WEBHOOK_EVENT_TYPES.length + 1)
  .transform((types): (WebhookEventType | "*")[] => (types.includes("*") ? ["*"] : [...new Set(types)]))
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

export const webhookSettingsUpdateSchema = z
  .object({ enabled: z.boolean() })
  .meta({ id: "WebhookSettingsUpdate" });
export type WebhookSettingsUpdateInput = z.infer<typeof webhookSettingsUpdateSchema>;

/**
 * `pending` waits for its first attempt, `retrying` had a failed attempt and waits for the next, `delivered`
 * succeeded, `dead` ran out of attempts (or the endpoint was turned off or gone) and can be redelivered.
 */
export const WEBHOOK_DELIVERY_STATUSES = ["pending", "retrying", "delivered", "dead"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const webhookDeliveryQuerySchema = z.object({
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
});
export type WebhookDeliveryQuery = z.infer<typeof webhookDeliveryQuerySchema>;

export interface WebhookSettingsRepr {
  /** Relay is set up for this installation; without it webhooks can't be turned on. */
  configured: boolean;
  enabled: boolean;
  enabled_at: string | null;
}

export interface WebhookEndpointRepr {
  id: string;
  url: string;
  description: string | null;
  event_types: (WebhookEventType | "*")[];
  enabled: boolean;
  /** Why the endpoint is off: turned off by a person, or by Relay after a day of failures or a 410 Gone. */
  disabled_reason: string | null;
  disabled_at: string | null;
  /** Failed attempts in a row, and since when; reset by a success. */
  failure_streak: number;
  failing_since: string | null;
  created_at: string;
}

/** The create and rotate responses: the endpoint plus its signing secret, shown once. */
export interface WebhookEndpointWithSecret extends WebhookEndpointRepr {
  secret: string;
}

export interface WebhookAttemptRepr {
  attempt: number;
  started_at: string;
  latency_ms: number;
  status_code: number | null;
  error: string | null;
  /** The first kilobyte of the receiver's answer. */
  response_excerpt: string | null;
  outcome: "delivered" | "retry" | "dead" | "skipped";
}

export interface WebhookDeliveryRepr {
  id: string;
  endpoint_id: string;
  event_id: string;
  /** Null when the event is no longer known (events are kept 7 days). */
  event_type: string | null;
  status: WebhookDeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  /** Why it is dead: `max_attempts`, `endpoint_gone`, `endpoint_disabled` or `rejected`. */
  dead_reason: string | null;
  /** The dead delivery this one redelivers, and when this one was redelivered. */
  replay_of: string | null;
  replayed_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WebhookDeliveryDetailRepr extends WebhookDeliveryRepr {
  attempt_log: WebhookAttemptRepr[];
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
