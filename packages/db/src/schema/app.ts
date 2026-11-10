import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
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
import { member, organization, user } from "./auth";

// Tenant-scoped tables. Every one carries organization_id, every index starts with it, and row-level
// security (migration 0001) limits rows to the organization set in `app.org_id` (ADR 003).

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
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
    requiredSkills: text("required_skills").array().notNull().default(sql`'{}'::text[]`),
    checklistTemplate: jsonb("checklist_template").notNull().default(sql`'[]'::jsonb`),
    color: text("color"),
    active: boolean("active").notNull().default(true),
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
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
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
    aiDrafted: boolean("ai_drafted").notNull().default(false),
    needsReview: boolean("needs_review").notNull().default(false),
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
    index("job_org_customer_idx").on(t.organizationId, t.customerId),
    index("job_org_site_idx").on(t.organizationId, t.siteId),
    index("job_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
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
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
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
    status: text("status").notNull().default("pending"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("attachment_org_job_idx").on(t.organizationId, t.jobId)],
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
] as const;
