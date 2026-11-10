import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { member, organization, user } from "./auth";
import { slaPolicy } from "./automate";
import { jobRecurrence } from "./paid";

// Tenant-scoped tables. Every one carries organization_id, every index starts with it, and row-level
// security (migration 0001) limits rows to the organization set in `app.org_id` (ADR 003).

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
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

/** Per-organization counters for human-readable numbers (JOB-000123). */
export const orgCounter = pgTable(
  "org_counter",
  {
    organizationId: orgId(),
    name: text("name").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.name] })],
);

export const serviceType = pgTable(
  "service_type",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    defaultDurationMin: integer("default_duration_min").notNull().default(60),
    defaultPriceMinor: bigint("default_price_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull(),
    requiredSkills: text("required_skills")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    checklistTemplate: jsonb("checklist_template")
      .notNull()
      .default(sql`'[]'::jsonb`),
    color: text("color"),
    active: boolean("active").notNull().default(true),
    /** Tax on this service (FIN-01). Null uses the organization's default tax rate. */
    taxRateBps: integer("tax_rate_bps"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("service_type_org_name_uq").on(t.organizationId, t.name)],
);

export const customer = pgTable(
  "customer",
  {
    id: id(),
    organizationId: orgId(),
    type: text("type").notNull().default("residential"),
    name: text("name").notNull(),
    billingAddress: jsonb("billing_address"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    /** Language of the customer's documents and emails (SET-05). Null uses the organization's default. */
    locale: text("locale"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("customer_org_name_idx").on(t.organizationId, t.name),
    index("customer_org_created_idx").on(t.organizationId, t.createdAt),
    index("customer_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export const contact = pgTable(
  "contact",
  {
    id: id(),
    organizationId: orgId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
    email: text("email"),
    emailNorm: text("email_norm"),
    phone: text("phone"),
    phoneNorm: text("phone_norm"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contact_org_customer_idx").on(t.organizationId, t.customerId),
    index("contact_org_email_idx").on(t.organizationId, t.emailNorm),
    index("contact_org_phone_idx").on(t.organizationId, t.phoneNorm),
  ],
);

export const site = pgTable(
  "site",
  {
    id: id(),
    organizationId: orgId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accessNotes: text("access_notes"),
    onsiteContactName: text("onsite_contact_name"),
    onsiteContactPhone: text("onsite_contact_phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("site_org_customer_idx").on(t.organizationId, t.customerId)],
);

export const equipment = pgTable(
  "equipment",
  {
    id: id(),
    organizationId: orgId(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    brand: text("brand"),
    model: text("model"),
    serial: text("serial"),
    installDate: date("install_date"),
    warrantyEnd: date("warranty_end"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("equipment_org_site_idx").on(t.organizationId, t.siteId)],
);

export const job = pgTable(
  "job",
  {
    id: id(),
    organizationId: orgId(),
    number: integer("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id),
    equipmentId: uuid("equipment_id").references(() => equipment.id),
    serviceTypeId: uuid("service_type_id").references(() => serviceType.id),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("new"),
    source: text("source").notNull().default("manual"),
    holdReason: text("hold_reason"),
    preferredStart: timestamp("preferred_start", { withTimezone: true }),
    preferredEnd: timestamp("preferred_end", { withTimezone: true }),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    estimatedDurationMin: integer("estimated_duration_min"),
    /** When the job was first scheduled with a technician: the response time for KPIs (DSH-01). */
    firstScheduledAt: timestamp("first_scheduled_at", { withTimezone: true }),
    /** Needed another visit (rescheduled from hold or reopened): excluded from first-visit completion. */
    revisit: boolean("revisit").notNull().default(false),
    aiDrafted: boolean("ai_drafted").notNull().default(false),
    needsReview: boolean("needs_review").notNull().default(false),
    /** Portal requests waiting for, or done with, an AI draft (AI-01): pending | drafted | failed | skipped. */
    aiStatus: text("ai_status"),
    /** The policy the deadlines came from (SLA-01). Null when the defaults applied. */
    slaPolicyId: uuid("sla_policy_id").references(() => slaPolicy.id, { onDelete: "set null" }),
    responseDueAt: timestamp("response_due_at", { withTimezone: true }),
    resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }),
    /** When 75% of each window is used, in the policy's time basis: the job turns "at risk" (SLA-02). */
    responseAtRiskAt: timestamp("response_at_risk_at", { withTimezone: true }),
    resolutionAtRiskAt: timestamp("resolution_at_risk_at", { withTimezone: true }),
    /** on_track | at_risk | breached | met (SLA-02). Updated on status changes and by the SLA monitor. */
    slaResponseState: text("sla_response_state"),
    slaResolutionState: text("sla_resolution_state"),
    /** While on hold waiting for the customer, the resolution clock is paused (SLA-04). */
    slaPausedAt: timestamp("sla_paused_at", { withTimezone: true }),
    /** Total minutes the resolution clock has been paused, in the policy's time basis. */
    slaPausedMinutes: integer("sla_paused_minutes").notNull().default(0),
    /** The maintenance plan that generated the job, and which occurrence (JOB-13). */
    recurrenceId: uuid("recurrence_id").references(() => jobRecurrence.id, { onDelete: "set null" }),
    occurrenceDate: date("occurrence_date"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("job_org_number_uq").on(t.organizationId, t.number),
    index("job_org_status_idx").on(t.organizationId, t.status),
    index("job_org_scheduled_idx").on(t.organizationId, t.scheduledStart),
    index("job_org_created_idx").on(t.organizationId, t.createdAt),
    index("job_org_completed_idx").on(t.organizationId, t.completedAt),
    index("job_org_service_type_idx").on(t.organizationId, t.serviceTypeId, t.createdAt),
    index("job_org_customer_idx").on(t.organizationId, t.customerId),
    index("job_org_site_idx").on(t.organizationId, t.siteId),
    index("job_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("job_org_resolution_due_idx").on(t.organizationId, t.resolutionDueAt),
    index("job_org_ai_status_idx")
      .on(t.organizationId, t.aiStatus)
      .where(sql`ai_status = 'pending'`),
    uniqueIndex("job_org_recurrence_occurrence_uq")
      .on(t.organizationId, t.recurrenceId, t.occurrenceDate)
      .where(sql`recurrence_id is not null`),
  ],
);

export const jobAssignment = pgTable(
  "job_assignment",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    isLead: boolean("is_lead").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("job_assignment_job_member_uq").on(t.organizationId, t.jobId, t.memberId),
    index("job_assignment_org_member_idx").on(t.organizationId, t.memberId),
  ],
);

export const checklistItem = pgTable(
  "checklist_item",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    label: text("label").notNull(),
    kind: text("kind").notNull().default("checkbox"),
    unit: text("unit"),
    required: boolean("required").notNull().default(false),
    value: jsonb("value"),
    doneBy: uuid("done_by").references(() => user.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("checklist_item_org_job_idx").on(t.organizationId, t.jobId)],
);

export const jobEvent = pgTable(
  "job_event",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("job_event_org_job_idx").on(t.organizationId, t.jobId, t.createdAt)],
);

export const note = pgTable(
  "note",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    visibility: text("visibility").notNull().default("internal"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("note_org_job_idx").on(t.organizationId, t.jobId)],
);

export const attachment = pgTable(
  "attachment",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("photo"),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    tag: text("tag"),
    /** Free text, e.g. the signer's name on a signature. */
    caption: text("caption"),
    status: text("status").notNull().default("pending"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("attachment_org_job_idx").on(t.organizationId, t.jobId)],
);

/** Technician time off (SCH-04). Times are instants; the UI works in the organization's time zone. */
export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    organizationId: orgId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("time_off_org_member_idx").on(t.organizationId, t.memberId, t.startsAt)],
);

/** Travel and work time per technician, recorded from status changes and editable with a reason (TEC-04). */
export const timeEntry = pgTable(
  "time_entry",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Null while the clock is running. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    source: text("source").notNull().default("status"),
    editedReason: text("edited_reason"),
    editedBy: uuid("edited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("time_entry_org_job_idx").on(t.organizationId, t.jobId),
    index("time_entry_org_member_idx").on(t.organizationId, t.memberId, t.startedAt),
  ],
);

/** Parts and expenses requested on a job, with the approval decision (EXP-01, EXP-02). */
export const expenseRequest = pgTable(
  "expense_request",
  {
    id: id(),
    organizationId: orgId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    requesterMemberId: uuid("requester_member_id").references(() => member.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("part"),
    item: text("item").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    supplier: text("supplier"),
    reason: text("reason").notNull(),
    receiptAttachmentId: uuid("receipt_attachment_id").references(() => attachment.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    decidedByMemberId: uuid("decided_by_member_id").references(() => member.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionComment: text("decision_comment"),
    /** When the technician recorded the part as used on the job (TEC-03). */
    usedAt: timestamp("used_at", { withTimezone: true }),
    billable: boolean("billable").notNull().default(true),
    markupBps: integer("markup_bps").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expense_request_org_job_idx").on(t.organizationId, t.jobId),
    index("expense_request_org_status_idx").on(t.organizationId, t.status, t.createdAt),
  ],
);

/** Named filter sets for the jobs table (JOB-04). Shared views are visible to the whole office. */
export const savedView = pgTable(
  "saved_view",
  {
    id: id(),
    organizationId: orgId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    resource: text("resource").notNull().default("jobs"),
    name: text("name").notNull(),
    /** URL query string of the filters, e.g. "status=new,scheduled&priority=urgent". */
    query: text("query").notNull(),
    shared: boolean("shared").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("saved_view_org_resource_idx").on(t.organizationId, t.resource, t.memberId)],
);

/** Stored responses for POST requests that carried an Idempotency-Key (kept 24 hours). */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    organizationId: orgId(),
    key: text("key").notNull(),
    userId: uuid("user_id").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

/**
 * Outgoing email. Every message is written here first; the worker sends it. In the public demo, messages
 * are marked "captured" and shown in the in-app Demo outbox instead of being sent (DEM-05).
 * Not tenant-scoped by RLS: sign-up and password emails have no organization.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("email_outbox_status_idx").on(t.status, t.createdAt),
    index("email_outbox_to_idx").on(t.toEmail, t.createdAt),
    index("email_outbox_org_idx").on(t.organizationId, t.createdAt),
  ],
);

export const TENANT_TABLES = [
  "org_counter",
  "service_type",
  "customer",
  "contact",
  "site",
  "equipment",
  "job",
  "job_assignment",
  "checklist_item",
  "job_event",
  "note",
  "attachment",
  "idempotency_key",
  "time_off",
  "time_entry",
  "expense_request",
  "saved_view",
  // 0.3 (schema/automate.ts)
  "sla_policy",
  "sla_alert",
  "notification",
  "notification_preference",
  "audit_log",
  "portal_token",
  "portal_session",
  "ai_interaction",
  // 0.4 (schema/paid.ts)
  "catalog_item",
  "quote",
  "quote_line",
  "invoice",
  "invoice_line",
  "payment",
  "invoice_reminder",
  "service_report",
  "job_recurrence",
  "assistant_conversation",
  "assistant_message",
  "daily_digest",
] as const;
