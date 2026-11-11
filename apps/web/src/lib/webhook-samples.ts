import {
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TEST_EVENT,
  type WebhookEnvelope,
  type WebhookEventGroup,
  type WebhookEventType,
} from "@fieldops/shared";

// Sample payloads for the event catalog on /settings/webhooks (PLT-03, §17.3). They mirror what the 0005 outbox
// triggers write: thin records with their key fields.

const ORG = "01a1c8e0-4d23-7473-b18e-00646fb12f15";
const job = {
  id: "01a1c8e0-50c9-773e-9f4d-e09df2d79dc2",
  number: "JOB-000123",
  title: "AC not cooling",
  status: "scheduled",
  priority: "high",
  source: "manual",
  customer_id: "01a1c8e0-4dd0-7a3c-8c3f-5f1e2d3c4b5a",
  site_id: "01a1c8e0-4de9-75e7-b8af-2aa3b0ac9f26",
  service_type_id: "01a1c8e0-4d40-7d3e-9b1a-0c2d3e4f5a6b",
  scheduled_start: "2026-11-12T09:00:00.000Z",
  scheduled_end: "2026-11-12T11:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-11T09:30:00.000Z",
};
const quote = {
  id: "01a1c8e1-146a-7058-9915-a9bb5bff9775",
  number: "QUO-2026-0042",
  title: "Replace the condenser fan motor",
  status: "sent",
  customer_id: job.customer_id,
  job_id: null,
  total_minor: 61269,
  currency: "USD",
  valid_until: "2026-12-02",
  decline_reason: null,
};
const invoice = {
  id: "01a1c8e1-2b7c-7a10-8e5f-3c4d5e6f7a8b",
  number: "INV-2026-0042",
  status: "sent",
  customer_id: job.customer_id,
  job_id: job.id,
  total_minor: 48500,
  amount_paid_minor: 0,
  currency: "USD",
  issue_date: "2026-11-11",
  due_date: "2026-11-25",
  paid_at: null,
};

const DATA: Record<WebhookEventType | typeof WEBHOOK_TEST_EVENT, Record<string, unknown>> = {
  "job.created": { job: { ...job, status: "new", scheduled_start: null, scheduled_end: null } },
  "job.updated": { job, changed: ["scheduled_start", "scheduled_end"] },
  "job.status_changed": { job: { ...job, status: "en_route" }, previous_status: "scheduled" },
  "job.assigned": {
    job,
    assignees: [
      { member_id: "01a1c8e0-4d5a-7b6c-8d7e-9f0a1b2c3d4e", is_lead: true },
      { member_id: "01a1c8e0-4d5a-7b6c-8d7e-9f0a1b2c3d4f", is_lead: false },
    ],
  },
  "job.completed": { job: { ...job, status: "completed", completed_at: "2026-11-12T10:47:00.000Z" } },
  "sla.at_risk": { job, clock: "response", due_at: "2026-11-11T17:00:00.000Z" },
  "sla.breached": { job, clock: "resolution", due_at: "2026-11-14T09:00:00.000Z" },
  "quote.sent": { quote },
  "quote.approved": { quote: { ...quote, status: "approved" } },
  "quote.declined": {
    quote: { ...quote, status: "declined", decline_reason: "Going with a repair instead" },
  },
  "invoice.sent": { invoice },
  "invoice.paid": {
    invoice: { ...invoice, status: "paid", amount_paid_minor: 48500, paid_at: "2026-11-13T15:02:00.000Z" },
  },
  "expense.decided": {
    expense: {
      id: "01a1c8e1-3c8d-7b20-9f6a-4d5e6f7a8b9c",
      job_id: job.id,
      status: "approved",
      kind: "part",
      item: "Capacitor 45/5 µF",
      total_minor: 3400,
      currency: "USD",
      auto_approved: false,
      decided_at: "2026-11-12T09:41:00.000Z",
    },
  },
  [WEBHOOK_TEST_EVENT]: {
    message: "A test event from FieldOps. Your endpoint received it.",
    endpoint_id: "ep_01jd8x4m2k7v9q3w5e6r7t8y9z",
    sent_at: "2026-11-11T09:30:00.000Z",
    sent_by: "Olivia Owner",
  },
};

export function sampleEnvelope(type: WebhookEventType | typeof WEBHOOK_TEST_EVENT): WebhookEnvelope {
  return {
    id: "evt_01jd8x4m2k7v9q3w5e6r7t8y9z",
    type,
    tenant: ORG,
    created_at: "2026-11-11T09:30:00.000Z",
    data: DATA[type],
  };
}

export const groupOf = (type: WebhookEventType) => type.split(".")[0] as WebhookEventGroup;

export const EVENTS_BY_GROUP: { group: WebhookEventGroup; types: WebhookEventType[] }[] =
  WEBHOOK_EVENT_GROUPS.map((group) => ({
    group,
    types: WEBHOOK_EVENT_TYPES.filter((t) => groupOf(t) === group),
  }));

/** A receiver in Node.js, without dependencies (Standard Webhooks). */
export const VERIFY_SNIPPET = `import crypto from "node:crypto";

// secret: the endpoint's "whsec_…" value. body: the raw request body (a string).
export function verify(secret, headers, body) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(\`\${id}.\${timestamp}.\${body}\`)
    .digest();
  // During a secret rotation the header carries two signatures.
  return headers["webhook-signature"].split(" ").some((s) => {
    const sig = Buffer.from(s.split(",")[1] ?? "", "base64");
    return sig.length === expected.length && crypto.timingSafeEqual(sig, expected);
  });
}`;
