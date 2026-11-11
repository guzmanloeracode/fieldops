import "server-only";
import {
  JOB_PRIORITIES,
  JOB_STATUSES,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TEST_EVENT,
  pageOf,
  problemSchema,
  webhookDeliveryQuerySchema,
  webhookEndpointCreateSchema,
  webhookEndpointUpdateSchema,
  webhookSettingsUpdateSchema,
  type WebhookEventType,
} from "@fieldops/shared";
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import type { OpenApiHelpers } from "./openapi-recurrences";

// Outgoing webhooks (PLT-03, §17.3, ADR 022) in the OpenAPI document: the management routes under /api/v1 and,
// in the document's `webhooks` section, every event FieldOps sends with its payload.

export const WEBHOOKS_TAG = {
  name: "Webhooks",
  description:
    "Outgoing webhooks, delivered by Relay: signed with Standard Webhooks headers, retried for about a day, and logged. Owners and admins.",
};

const ts = z.iso.datetime();
const nullableTs = ts.nullable();

const endpointSchema = z
  .object({
    id: z.string().meta({ example: "ep_01jd8x4m2k7v9q3w5e6r7t8y9z" }),
    url: z.string(),
    description: z.string().nullable(),
    event_types: z.array(z.union([z.enum(WEBHOOK_EVENT_TYPES), z.literal("*")])),
    enabled: z.boolean(),
    disabled_reason: z
      .string()
      .nullable()
      .meta({ description: "Turned off by a person, or by Relay after a day of failures or a 410 Gone" }),
    disabled_at: nullableTs,
    failure_streak: z.number().int().meta({ description: "Failed attempts in a row" }),
    failing_since: nullableTs,
    created_at: ts,
  })
  .meta({ id: "WebhookEndpoint" });

const endpointWithSecretSchema = endpointSchema
  .extend({
    secret: z.string().meta({
      description: "The signing secret (`whsec_` + base64). Only in this response: store it now.",
      example: "whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD",
    }),
  })
  .meta({ id: "WebhookEndpointWithSecret" });

const deliverySchema = z
  .object({
    id: z.string().meta({ example: "dlv_01jd8x4m2k7v9q3w5e6r7t8y9z" }),
    endpoint_id: z.string(),
    event_id: z.string().meta({ description: "The `webhook-id` header and the body's `id`" }),
    event_type: z.string().nullable().meta({ description: "Null when the event is older than 7 days" }),
    status: z.enum(WEBHOOK_DELIVERY_STATUSES),
    attempts: z.number().int(),
    max_attempts: z.number().int(),
    next_attempt_at: nullableTs,
    last_status_code: z.number().int().nullable(),
    last_error: z.string().nullable(),
    dead_reason: z.string().nullable().meta({
      description: "`max_attempts`, `endpoint_gone`, `endpoint_disabled` or `rejected`",
    }),
    replay_of: z.string().nullable().meta({ description: "The dead delivery this one redelivers" }),
    replayed_at: nullableTs,
    created_at: ts,
    completed_at: nullableTs,
  })
  .meta({ id: "WebhookDelivery" });

const deliveryDetailSchema = deliverySchema
  .extend({
    attempt_log: z.array(
      z.object({
        attempt: z.number().int(),
        started_at: ts,
        latency_ms: z.number().int(),
        status_code: z.number().int().nullable(),
        error: z.string().nullable(),
        response_excerpt: z.string().nullable().meta({ description: "The first kilobyte of the answer" }),
        outcome: z.enum(["delivered", "retry", "dead", "skipped"]),
      }),
    ),
  })
  .meta({ id: "WebhookDeliveryDetail" });

const settingsSchema = z
  .object({
    configured: z.boolean().meta({ description: "Relay is set up on this server" }),
    enabled: z.boolean(),
    enabled_at: nullableTs,
  })
  .meta({ id: "WebhookSettings" });

const endpointList = z.object({ data: z.array(endpointSchema) }).meta({ id: "WebhookEndpointList" });
const idParam = (what: string, example: string) =>
  z.object({ id: z.string().meta({ description: `${what} ID`, example }) });
const endpointId = idParam("Endpoint", "ep_01jd8x4m2k7v9q3w5e6r7t8y9z");
const deliveryId = idParam("Delivery", "dlv_01jd8x4m2k7v9q3w5e6r7t8y9z");

const unavailable = {
  "503": {
    description:
      "Webhooks aren't configured on this server (`reason: not_configured`), or Relay can't be reached",
    content: { "application/problem+json": { schema: problemSchema } },
  },
};

export function webhookPaths(h: OpenApiHelpers): ZodOpenApiPathsObject {
  const tag = WEBHOOKS_TAG.name;
  return {
    "/webhook-settings": {
      get: h.op(tag, "Get webhook settings", {
        operationId: "getWebhookSettings",
        responses: { "200": h.json(settingsSchema, "Whether webhooks are on"), ...unavailable },
      }),
      put: h.op(tag, "Turn webhooks on or off", {
        operationId: "updateWebhookSettings",
        description:
          "Turning on makes the organization a Relay tenant; from then on its changes are published as events. Turning off stops new events; endpoints and their log stay.",
        requestBody: h.body(webhookSettingsUpdateSchema),
        responses: { "200": h.json(settingsSchema, "The settings"), ...h.errors(415, 422), ...unavailable },
      }),
    },
    "/webhook-endpoints": {
      get: h.op(tag, "List webhook endpoints", {
        operationId: "listWebhookEndpoints",
        responses: { "200": h.json(endpointList, "Every endpoint (at most 10)"), ...unavailable },
      }),
      post: h.op(tag, "Create a webhook endpoint", {
        operationId: "createWebhookEndpoint",
        description:
          "Webhooks must be on. The URL must be https on a public host; Relay also refuses private and reserved addresses. The response carries the signing secret, the only time it is shown (rotate it to get a new one).",
        requestParams: { header: h.idempotencyHeader },
        requestBody: h.body(webhookEndpointCreateSchema),
        responses: {
          "201": h.json(endpointWithSecretSchema, "The endpoint and its secret"),
          ...h.errors(400, 409, 415, 422),
          ...unavailable,
        },
      }),
    },
    "/webhook-endpoints/{id}": {
      get: h.op(tag, "Get a webhook endpoint", {
        operationId: "getWebhookEndpoint",
        requestParams: { path: endpointId },
        responses: { "200": h.json(endpointSchema, "The endpoint"), ...h.errors(404), ...unavailable },
      }),
      patch: h.op(tag, "Update a webhook endpoint", {
        operationId: "updateWebhookEndpoint",
        description:
          "`enabled: true` turns an endpoint back on after Relay turned it off; redeliver what it missed from its dead deliveries.",
        requestParams: { path: endpointId },
        requestBody: h.body(webhookEndpointUpdateSchema),
        responses: {
          "200": h.json(endpointSchema, "The endpoint"),
          ...h.errors(404, 415, 422),
          ...unavailable,
        },
      }),
      delete: h.op(tag, "Delete a webhook endpoint", {
        operationId: "deleteWebhookEndpoint",
        description: "Deletes its delivery log too.",
        requestParams: { path: endpointId },
        responses: { "204": { description: "Deleted" }, ...h.errors(404), ...unavailable },
      }),
    },
    "/webhook-endpoints/{id}/rotate-secret": {
      post: h.op(tag, "Rotate an endpoint's signing secret", {
        operationId: "rotateWebhookSecret",
        description:
          "For the next 24 hours each request carries a signature with the old secret too, so the receiver can switch without dropping requests.",
        requestParams: { path: endpointId, header: h.idempotencyHeader },
        responses: {
          "200": h.json(endpointWithSecretSchema, "The endpoint and its new secret"),
          ...h.errors(404),
          ...unavailable,
        },
      }),
    },
    "/webhook-endpoints/{id}/test": {
      post: h.op(tag, "Send a test event", {
        operationId: "sendWebhookTest",
        description: `Sends a \`${WEBHOOK_TEST_EVENT}\` event to this endpoint only, whatever it subscribes to. The endpoint must be on.`,
        requestParams: { path: endpointId, header: h.idempotencyHeader },
        responses: {
          "202": h.json(z.object({ event_id: z.string() }).meta({ id: "WebhookTestSent" }), "Accepted"),
          ...h.errors(404, 409),
          ...unavailable,
        },
      }),
    },
    "/webhook-endpoints/{id}/deliveries": {
      get: h.op(tag, "List an endpoint's deliveries", {
        operationId: "listWebhookDeliveries",
        description: "Newest first. Relay keeps 7 days.",
        requestParams: { path: endpointId, query: webhookDeliveryQuerySchema },
        responses: {
          "200": h.json(pageOf(deliverySchema, "WebhookDeliveryPage"), "A page of deliveries"),
          ...h.errors(404, 422),
          ...unavailable,
        },
      }),
    },
    "/webhook-deliveries/{id}": {
      get: h.op(tag, "Get a delivery with its attempts", {
        operationId: "getWebhookDelivery",
        requestParams: { path: deliveryId },
        responses: {
          "200": h.json(deliveryDetailSchema, "The delivery and every attempt"),
          ...h.errors(404),
          ...unavailable,
        },
      }),
    },
    "/webhook-deliveries/{id}/redeliver": {
      post: h.op(tag, "Redeliver a dead delivery", {
        operationId: "redeliverWebhook",
        description:
          "Only deliveries that ran out of attempts (`dead`), once each, to an endpoint that is on. The new delivery carries the same event id, so receivers that already processed it can skip it.",
        requestParams: { path: deliveryId, header: h.idempotencyHeader },
        responses: {
          "202": h.json(deliverySchema, "The new delivery"),
          ...h.errors(404, 409),
          ...unavailable,
        },
      }),
    },
  };
}

// ------------------------------------------------------------------ events

const jobData = z
  .object({
    id: z.uuid(),
    number: z.string().meta({ example: "JOB-000123" }),
    title: z.string(),
    status: z.enum(JOB_STATUSES),
    priority: z.enum(JOB_PRIORITIES),
    source: z.string(),
    customer_id: z.uuid(),
    site_id: z.uuid(),
    service_type_id: z.uuid().nullable(),
    scheduled_start: nullableTs,
    scheduled_end: nullableTs,
    completed_at: nullableTs,
    updated_at: ts,
  })
  .meta({ id: "WebhookJob", description: "The job's key fields; GET /jobs/{id} has the rest" });

const quoteData = z
  .object({
    id: z.uuid(),
    number: z.string().meta({ example: "QUO-2026-0042" }),
    title: z.string(),
    status: z.enum(["sent", "approved", "declined"]),
    customer_id: z.uuid(),
    job_id: z.uuid().nullable(),
    total_minor: z.number().int(),
    currency: z.string(),
    valid_until: z.iso.date().nullable(),
    decline_reason: z.string().nullable(),
  })
  .meta({ id: "WebhookQuote" });

const invoiceData = z
  .object({
    id: z.uuid(),
    number: z.string().nullable().meta({ example: "INV-2026-0042" }),
    status: z.enum(["sent", "paid"]),
    customer_id: z.uuid(),
    job_id: z.uuid().nullable(),
    total_minor: z.number().int(),
    amount_paid_minor: z.number().int(),
    currency: z.string(),
    issue_date: z.iso.date().nullable(),
    due_date: z.iso.date().nullable(),
    paid_at: nullableTs,
  })
  .meta({ id: "WebhookInvoice" });

const expenseData = z
  .object({
    id: z.uuid(),
    job_id: z.uuid(),
    status: z.enum(["approved", "rejected"]),
    kind: z.string(),
    item: z.string(),
    total_minor: z.number().int(),
    currency: z.string(),
    auto_approved: z.boolean(),
    decided_at: nullableTs,
  })
  .meta({ id: "WebhookExpense" });

const EVENT_DATA: Record<WebhookEventType, { summary: string; data: z.ZodObject }> = {
  "job.created": { summary: "A job was created", data: z.object({ job: jobData }) },
  "job.updated": {
    summary: "A job's details changed (title, priority, customer, site, schedule…)",
    data: z.object({
      job: jobData,
      changed: z
        .array(z.string())
        .meta({ description: "The fields that changed", example: ["scheduled_start"] }),
    }),
  },
  "job.status_changed": {
    summary: "A job moved to another status",
    data: z.object({ job: jobData, previous_status: z.enum(JOB_STATUSES) }),
  },
  "job.assigned": {
    summary: "A job's technicians were set; `assignees` is the whole team",
    data: z.object({
      job: jobData,
      assignees: z.array(z.object({ member_id: z.uuid(), is_lead: z.boolean() })),
    }),
  },
  "job.completed": { summary: "A job was completed", data: z.object({ job: jobData }) },
  "sla.at_risk": {
    summary: "A job used 75% of its response or resolution window",
    data: z.object({ job: jobData, clock: z.enum(["response", "resolution"]), due_at: nullableTs }),
  },
  "sla.breached": {
    summary: "A job missed its response or resolution target",
    data: z.object({ job: jobData, clock: z.enum(["response", "resolution"]), due_at: nullableTs }),
  },
  "quote.sent": { summary: "A quote was sent to the customer", data: z.object({ quote: quoteData }) },
  "quote.approved": { summary: "The customer approved a quote", data: z.object({ quote: quoteData }) },
  "quote.declined": { summary: "The customer declined a quote", data: z.object({ quote: quoteData }) },
  "invoice.sent": { summary: "An invoice was issued", data: z.object({ invoice: invoiceData }) },
  "invoice.paid": { summary: "An invoice was paid in full", data: z.object({ invoice: invoiceData }) },
  "expense.decided": {
    summary: "A part or expense request was approved or rejected",
    data: z.object({ expense: expenseData }),
  },
};

const signatureHeaders = z.object({
  "webhook-id": z
    .string()
    .meta({ description: "The event ID; deduplicate on it (delivery is at least once)" }),
  "webhook-timestamp": z
    .string()
    .meta({ description: "Unix seconds; reject values more than 5 minutes off" }),
  "webhook-signature": z.string().meta({
    description:
      "`v1,<base64 HMAC-SHA256>` of `{webhook-id}.{webhook-timestamp}.{body}` with the base64-decoded part of the secret after `whsec_`; space-separated when a rotated secret signs too",
  }),
});

function envelope(type: string, data: z.ZodObject) {
  const id = type
    .split(/[._]/)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
  return z
    .object({
      id: z.string().meta({ example: "evt_01jd8x4m2k7v9q3w5e6r7t8y9z" }),
      type: z.literal(type),
      tenant: z.uuid().meta({ description: "The organization ID" }),
      created_at: ts,
      data,
    })
    .meta({ id: `${id}Event` });
}

/** The OpenAPI 3.1 `webhooks` section: one POST per event FieldOps sends. */
export function webhookEvents(): ZodOpenApiPathsObject {
  const all = { ...EVENT_DATA } as Record<string, { summary: string; data: z.ZodObject }>;
  all[WEBHOOK_TEST_EVENT] = {
    summary: "Sent by “Send test event”, to that endpoint only",
    data: z.object({
      message: z.string(),
      endpoint_id: z.string(),
      sent_at: ts,
      sent_by: z.string(),
    }),
  };
  return Object.fromEntries(
    Object.entries(all).map(([type, { summary, data }]) => [
      type,
      {
        post: {
          tags: [WEBHOOKS_TAG.name],
          summary,
          operationId: `event_${type.replace(/\W/g, "_")}`,
          requestParams: { header: signatureHeaders },
          requestBody: { required: true, content: { "application/json": { schema: envelope(type, data) } } },
          responses: {
            "2XX": { description: "Received. Answer within 10 seconds; anything else is retried." },
            "410": { description: "Gone: Relay turns the endpoint off at once." },
          },
        },
      },
    ]),
  );
}
