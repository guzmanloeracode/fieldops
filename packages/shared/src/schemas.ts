import { z } from "zod";
import { csvEnum, hhmm, isoDateTime, optionalText, queryBool, trimmed, ts } from "./fields";
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_TAGS,
  CURRENCIES,
  CUSTOMER_TYPES,
  HOLD_REASONS,
  JOB_EVENT_TYPES,
  JOB_PRIORITIES,
  JOB_SOURCES,
  JOB_STATUSES,
  NOTE_VISIBILITIES,
  ROLES,
  CHECKLIST_ITEM_KINDS,
  SLA_STATES,
  AI_STATUSES,
  LOCALES,
} from "./constants";

// Inputs and API representations use snake_case, matching the public REST API (/api/v1).
// Server actions validate with the same schemas, so web, mobile and API share one contract.

export const roleSchema = z.enum(ROLES).meta({ id: "Role" });
export const jobStatusSchema = z.enum(JOB_STATUSES).meta({ id: "JobStatus" });
export const jobPrioritySchema = z.enum(JOB_PRIORITIES).meta({ id: "JobPriority" });
export const jobSourceSchema = z.enum(JOB_SOURCES).meta({ id: "JobSource" });
/** Language of the UI, emails and documents (SET-05). */
export const localeSchema = z.enum(LOCALES).meta({ id: "Locale" });
export const customerTypeSchema = z.enum(CUSTOMER_TYPES).meta({ id: "CustomerType" });
export const currencySchema = z.enum(CURRENCIES).meta({ id: "Currency" });
export const slaStateSchema = z.enum(SLA_STATES).meta({ id: "SlaState" });
export const aiStatusSchema = z.enum(AI_STATUSES).meta({ id: "AiStatus" });

// ---------------------------------------------------------------- addresses
export const addressSchema = z
  .object({
    line1: trimmed(200).min(1),
    line2: optionalText(200),
    city: trimmed(120).min(1),
    region: optionalText(120),
    postal_code: optionalText(20),
    country: z.string().trim().length(2).toUpperCase(),
  })
  .meta({ id: "Address" });
export type AddressInput = z.input<typeof addressSchema>;
/** Address as returned by the API (no input transforms, so it renders as an output schema). */
export const addressDtoSchema = z
  .object({
    line1: z.string(),
    line2: z.string().nullable().optional(),
    city: z.string(),
    region: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    country: z.string().meta({ description: "ISO 3166-1 alpha-2 code", example: "US" }),
  })
  .meta({ id: "AddressValue" });
export type Address = z.output<typeof addressSchema>;

// ---------------------------------------------------------------- customers
export const contactInputSchema = z
  .object({
    name: trimmed(160).min(1),
    role: optionalText(80),
    email: z
      .union([z.literal(""), z.email().max(254)])
      .transform((v) => (v === "" ? null : v.toLowerCase()))
      .nullable()
      .optional(),
    phone: optionalText(40),
    is_primary: z.boolean().default(false),
  })
  .meta({ id: "ContactInput" });
export type ContactInput = z.input<typeof contactInputSchema>;

export const customerCreateSchema = z
  .object({
    type: customerTypeSchema.default("residential"),
    name: trimmed(200).min(1),
    billing_address: addressSchema.nullable().optional(),
    tags: z.array(trimmed(40).min(1)).max(20).default([]),
    notes: optionalText(4000),
    contacts: z.array(contactInputSchema).max(20).default([]),
    /** Language of the customer's emails and documents; null follows the organization (SET-05). */
    locale: localeSchema.nullable().optional(),
  })
  .meta({ id: "CustomerCreate" });
export type CustomerCreateInput = z.input<typeof customerCreateSchema>;
export type CustomerCreate = z.output<typeof customerCreateSchema>;

// Update schemas are written out without .default(): in Zod 4, .partial() keeps defaults, so a PATCH of
// one field would silently reset the others (for example type and tags) to their defaults.
export const customerUpdateSchema = z
  .object({
    type: customerTypeSchema,
    name: trimmed(200).min(1),
    billing_address: addressSchema.nullable(),
    tags: z.array(trimmed(40).min(1)).max(20),
    notes: optionalText(4000),
    locale: localeSchema.nullable(),
  })
  .partial()
  .meta({ id: "CustomerUpdate" });
export type CustomerUpdate = z.output<typeof customerUpdateSchema>;

export const siteCreateSchema = z
  .object({
    label: trimmed(120).min(1),
    address: addressSchema,
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    access_notes: optionalText(2000),
    onsite_contact_name: optionalText(160),
    onsite_contact_phone: optionalText(40),
  })
  .meta({ id: "SiteCreate" });
export type SiteCreate = z.output<typeof siteCreateSchema>;
export const siteUpdateSchema = siteCreateSchema.partial().meta({ id: "SiteUpdate" });
export type SiteUpdate = z.output<typeof siteUpdateSchema>;

// ---------------------------------------------------------------- jobs
export const jobCreateSchema = z
  .object({
    customer_id: z.uuid(),
    site_id: z.uuid(),
    equipment_id: z.uuid().nullable().optional(),
    service_type_id: z.uuid().nullable().optional(),
    title: trimmed(200).min(1),
    description: optionalText(8000),
    priority: jobPrioritySchema.default("normal"),
    source: jobSourceSchema.default("manual"),
    preferred_start: isoDateTime.nullable().optional(),
    preferred_end: isoDateTime.nullable().optional(),
    estimated_duration_min: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .nullable()
      .optional(),
  })
  .refine((v) => !v.preferred_start || !v.preferred_end || v.preferred_end > v.preferred_start, {
    message: "Preferred end must be after preferred start",
    path: ["preferred_end"],
  })
  .meta({ id: "JobCreate" });
export type JobCreateInput = z.input<typeof jobCreateSchema>;
export type JobCreate = z.output<typeof jobCreateSchema>;

export const jobUpdateSchema = z
  .object({
    equipment_id: z.uuid().nullable(),
    service_type_id: z.uuid().nullable(),
    title: trimmed(200).min(1),
    description: optionalText(8000),
    priority: jobPrioritySchema,
    preferred_start: isoDateTime.nullable(),
    preferred_end: isoDateTime.nullable(),
    estimated_duration_min: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .nullable(),
  })
  .partial()
  .meta({ id: "JobUpdate" });
export type JobUpdate = z.output<typeof jobUpdateSchema>;

export const jobTransitionSchema = z
  .object({
    to: jobStatusSchema,
    reason: optionalText(1000),
    hold_reason: z.enum(HOLD_REASONS).nullable().optional(),
  })
  .meta({ id: "JobTransition" });
export type JobTransitionInput = z.output<typeof jobTransitionSchema>;

export const jobAssignmentSchema = z
  .object({
    member_ids: z.array(z.uuid()).max(10),
    lead_member_id: z.uuid().nullable().optional(),
    scheduled_start: isoDateTime.nullable().optional(),
    scheduled_end: isoDateTime.nullable().optional(),
    override_reason: optionalText(500),
  })
  .refine((v) => !v.lead_member_id || v.member_ids.includes(v.lead_member_id), {
    message: "Lead technician must be one of the assigned members",
    path: ["lead_member_id"],
  })
  .refine((v) => Boolean(v.scheduled_start) === Boolean(v.scheduled_end), {
    message: "Set both start and end, or neither",
    path: ["scheduled_end"],
  })
  .refine((v) => !v.scheduled_start || !v.scheduled_end || v.scheduled_end > v.scheduled_start, {
    message: "End must be after start",
    path: ["scheduled_end"],
  })
  .meta({ id: "JobAssignment" });
export type JobAssignmentInput = z.output<typeof jobAssignmentSchema>;

export const noteCreateSchema = z
  .object({
    body: trimmed(8000).min(1),
    visibility: z.enum(NOTE_VISIBILITIES).default("internal"),
  })
  .meta({ id: "NoteCreate" });
export type NoteCreate = z.output<typeof noteCreateSchema>;

export const attachmentUploadSchema = z
  .object({
    file_name: trimmed(200).min(1),
    mime_type: z.string().max(100),
    size_bytes: z.number().int().positive(),
    kind: z.enum(ATTACHMENT_KINDS).default("photo"),
    tag: z.enum(ATTACHMENT_TAGS).nullable().optional(),
    caption: optionalText(120),
    with_thumbnail: z.boolean().default(false),
  })
  .meta({ id: "AttachmentUploadRequest" });
export type AttachmentUploadInput = z.output<typeof attachmentUploadSchema>;

// ---------------------------------------------------------------- organization
export const businessHoursSchema = z
  .array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: hhmm,
      close: hhmm,
    }),
  )
  .max(7)
  .meta({ id: "BusinessHours" });

export const taxRateSchema = z
  .object({
    name: trimmed(60).min(1),
    rate_bps: z.number().int().min(0).max(10_000),
    default: z.boolean().default(false),
  })
  .meta({ id: "TaxRate" });

export const organizationUpdateSchema = z
  .object({
    name: trimmed(120).min(2),
    timezone: z.string().min(1).max(64),
    currency: currencySchema,
    country: z.string().trim().length(2).toUpperCase(),
    brand_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0EA5E9")
      .nullable()
      .optional(),
    address: addressSchema.nullable().optional(),
    business_hours: businessHoursSchema.optional(),
    tax_rates: z.array(taxRateSchema).max(10).optional(),
    /** Language for customers without their own: portal, emails and documents (SET-05). */
    locale: localeSchema.optional(),
  })
  .partial()
  .meta({ id: "OrganizationUpdate" });
export type OrganizationUpdate = z.output<typeof organizationUpdateSchema>;

export const organizationCreateSchema = z.object({
  name: trimmed(120).min(2),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "3–48 lowercase letters, numbers or hyphens"),
  timezone: z.string().min(1).max(64),
  currency: currencySchema,
  country: z.string().trim().length(2).toUpperCase(),
});
export type OrganizationCreate = z.output<typeof organizationCreateSchema>;

export const skillSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9 -]{0,38}[a-z0-9]$/, "2–40 letters, numbers, spaces or hyphens");

/** One line of a service type's checklist template (JOB-08). */
export const checklistTemplateItemSchema = z
  .object({
    label: trimmed(200).min(1),
    kind: z.enum(CHECKLIST_ITEM_KINDS).default("checkbox"),
    unit: optionalText(20),
    required: z.boolean().default(false),
  })
  .meta({ id: "ChecklistTemplateItem" });
export type ChecklistTemplateItem = z.output<typeof checklistTemplateItemSchema>;

/** The template item as the API returns it (no input transforms, so it can describe a response). */
export const checklistTemplateItemDtoSchema = z
  .object({
    label: z.string(),
    kind: z.enum(CHECKLIST_ITEM_KINDS),
    unit: z.string().nullable(),
    required: z.boolean(),
  })
  .meta({ id: "ChecklistTemplateItemOut" });

export const serviceTypeInputSchema = z
  .object({
    name: trimmed(120).min(1),
    description: optionalText(1000),
    default_duration_min: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(60),
    default_price_minor: z.number().int().min(0).default(0),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    active: z.boolean().default(true),
    required_skills: z.array(skillSchema).max(10).default([]),
    checklist_template: z.array(checklistTemplateItemSchema).max(50).default([]),
    /** One of the organization's tax rates (FIN-01); null uses the default rate. */
    tax_rate_bps: z.number().int().min(0).max(10_000).nullable().optional(),
  })
  .meta({ id: "ServiceTypeInput" });
export type ServiceTypeInput = z.output<typeof serviceTypeInputSchema>;

/** Partial update without defaults (see customerUpdateSchema). */
export const serviceTypeUpdateSchema = z
  .object({
    name: trimmed(120).min(1),
    description: optionalText(1000),
    default_duration_min: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
    default_price_minor: z.number().int().min(0),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    active: z.boolean(),
    required_skills: z.array(skillSchema).max(10),
    checklist_template: z.array(checklistTemplateItemSchema).max(50),
    tax_rate_bps: z.number().int().min(0).max(10_000).nullable(),
  })
  .partial()
  .meta({ id: "ServiceTypeUpdate" });
export type ServiceTypeUpdate = z.output<typeof serviceTypeUpdateSchema>;

export const inviteSchema = z.object({
  email: z.email().max(254).toLowerCase(),
  role: z.enum(["admin", "dispatcher", "technician"]),
});
export type InviteInput = z.output<typeof inviteSchema>;

// ---------------------------------------------------------------- list queries

export const jobListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csvEnum(JOB_STATUSES).optional(),
  priority: csvEnum(JOB_PRIORITIES).optional(),
  technician: z.uuid().optional(),
  service_type: z.uuid().optional(),
  customer: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Which date `from` and `to` apply to. "scheduled" falls back to the creation date for unscheduled jobs. */
  date_field: z.enum(["scheduled", "created", "completed"]).optional(),
  /** Only jobs without a technician. */
  unassigned: queryBool.optional(),
  /** Only jobs that needed another visit (rescheduled from hold or reopened). */
  revisit: queryBool.optional(),
  /** Only portal requests waiting for a dispatcher to confirm them (AI-01). */
  needs_review: queryBool.optional(),
  /**
   * The job's current SLA state (SLA-02): the worse of its open targets (response until first scheduled,
   * resolution until completed); for completed jobs the resolution outcome.
   */
  sla: csvEnum(SLA_STATES).optional(),
  sort: z
    .string()
    .regex(
      /^-?(number|scheduled_start|created_at|priority|status|title)(,-?(number|scheduled_start|created_at|priority|status|title))*$/,
    )
    .default("-created_at"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type JobListQuery = z.output<typeof jobListQuerySchema>;

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(["name", "-name", "created_at", "-created_at"]).default("name"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type CustomerListQuery = z.output<typeof customerListQuerySchema>;

// ---------------------------------------------------------------- API outputs

export const memberRefSchema = z
  .object({ member_id: z.uuid(), name: z.string(), is_lead: z.boolean() })
  .meta({ id: "AssignedMember" });

export const jobSchema = z
  .object({
    id: z.uuid(),
    number: z.string().meta({ example: "JOB-000123" }),
    title: z.string(),
    description: z.string().nullable(),
    status: jobStatusSchema,
    priority: jobPrioritySchema,
    source: jobSourceSchema,
    customer: z.object({ id: z.uuid(), name: z.string() }),
    site: z.object({ id: z.uuid(), label: z.string(), city: z.string() }),
    service_type: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    equipment_id: z.uuid().nullable(),
    assignees: z.array(memberRefSchema),
    preferred_start: ts.nullable(),
    preferred_end: ts.nullable(),
    scheduled_start: ts.nullable(),
    scheduled_end: ts.nullable(),
    completed_at: ts.nullable(),
    estimated_duration_min: z.number().int().nullable(),
    hold_reason: z.enum(HOLD_REASONS).nullable(),
    needs_review: z.boolean(),
    ai_drafted: z.boolean(),
    ai_status: aiStatusSchema
      .nullable()
      .meta({ description: "AI drafting of a portal request; null for other jobs" }),
    response_due_at: ts.nullable().meta({ description: "SLA: schedule with a technician by this time" }),
    resolution_due_at: ts.nullable().meta({ description: "SLA: complete by this time" }),
    sla_response_state: slaStateSchema.nullable(),
    sla_resolution_state: slaStateSchema.nullable(),
    sla_paused_at: ts
      .nullable()
      .meta({ description: "SLA-04: the resolution clock is paused while on hold for the customer" }),
    recurrence_id: z.uuid().nullable().meta({ description: "The maintenance plan that generated the job" }),
    occurrence_date: z.string().nullable().meta({ format: "date", description: "The plan's visit date" }),
    version: z.number().int().meta({ description: "Increments on every change. Sent as the ETag." }),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "Job" });
export type JobDto = z.infer<typeof jobSchema>;

export const contactSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    role: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    is_primary: z.boolean(),
  })
  .meta({ id: "Contact" });

export const siteSchema = z
  .object({
    id: z.uuid(),
    customer_id: z.uuid(),
    label: z.string(),
    address: addressDtoSchema,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    access_notes: z.string().nullable(),
    onsite_contact_name: z.string().nullable(),
    onsite_contact_phone: z.string().nullable(),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "Site" });
export type SiteDto = z.infer<typeof siteSchema>;

export const customerSchema = z
  .object({
    id: z.uuid(),
    type: customerTypeSchema,
    name: z.string(),
    billing_address: addressDtoSchema.nullable(),
    tags: z.array(z.string()),
    notes: z.string().nullable(),
    locale: localeSchema
      .nullable()
      .meta({ description: "Null follows the organization's customer language" }),
    contacts: z.array(contactSchema),
    site_count: z.number().int(),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "Customer" });
export type CustomerDto = z.infer<typeof customerSchema>;

export const noteSchema = z
  .object({
    id: z.uuid(),
    body: z.string(),
    visibility: z.enum(NOTE_VISIBILITIES),
    author: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    created_at: ts,
  })
  .meta({ id: "Note" });

export const jobEventSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(JOB_EVENT_TYPES),
    from_status: jobStatusSchema.nullable(),
    to_status: jobStatusSchema.nullable(),
    actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    payload: z.record(z.string(), z.unknown()),
    created_at: ts,
  })
  .meta({ id: "JobEvent" });

export const attachmentUploadResponseSchema = z
  .object({
    attachment_id: z.uuid(),
    upload_url: z.url(),
    thumbnail_upload_url: z.url().nullable(),
    headers: z.record(z.string(), z.string()),
    expires_in: z.number().int(),
  })
  .meta({ id: "AttachmentUploadResponse" });

export const memberSchema = z
  .object({
    id: z.uuid(),
    user_id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: roleSchema,
    created_at: ts,
  })
  .meta({ id: "Member" });

export const meSchema = z
  .object({
    user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
    organization: z
      .object({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
        timezone: z.string(),
        currency: currencySchema,
      })
      .nullable(),
    role: roleSchema.nullable(),
  })
  .meta({ id: "Me" });

export const serviceTypeSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    default_duration_min: z.number().int(),
    default_price_minor: z.number().int(),
    currency: currencySchema,
    active: z.boolean(),
    required_skills: z.array(z.string()),
    checklist_template: z.array(checklistTemplateItemDtoSchema),
    /** Null uses the organization's default tax rate. */
    tax_rate_bps: z.number().int().nullable(),
  })
  .meta({ id: "ServiceType" });

export const problemSchema = z
  .looseObject({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: "Problem", description: "RFC 9457 problem details" });
export type Problem = z.infer<typeof problemSchema>;

export const pageOf = <T extends z.ZodType>(item: T, id: string) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable() }).meta({ id });

export const attachmentKindSchema = z.enum(ATTACHMENT_KINDS);
export const jobEventTypeSchema = z.enum(JOB_EVENT_TYPES);

// ---------------------------------------------------------------- API outputs added for /api/v1

export const jobDetailSchema = jobSchema
  .extend({
    allowed_transitions: z
      .array(
        z.object({
          to: jobStatusSchema,
          name: z.string().meta({ example: "start" }),
          requires_reason: z.boolean(),
        }),
      )
      .meta({ description: "Status changes the current user may make from the job's current status" }),
  })
  .meta({ id: "JobDetail" });
export type JobDetailDto = z.infer<typeof jobDetailSchema>;

export const customerSummarySchema = z
  .object({
    id: z.uuid(),
    type: customerTypeSchema,
    name: z.string(),
    tags: z.array(z.string()),
    primary_contact: z
      .object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable() })
      .nullable(),
    site_count: z.number().int(),
    open_job_count: z.number().int(),
    last_job_at: ts.nullable(),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "CustomerSummary" });
export type CustomerSummaryDto = z.infer<typeof customerSummarySchema>;

export const customerCreatedSchema = customerSchema
  .extend({
    possible_duplicates: z
      .array(z.object({ id: z.uuid(), name: z.string(), matched_on: z.enum(["email", "phone"]) }))
      .meta({
        description:
          "Existing customers with a matching contact email or phone. The customer is created anyway.",
      }),
  })
  .meta({ id: "CustomerCreated" });

export const equipmentSchema = z
  .object({
    id: z.uuid(),
    site_id: z.uuid(),
    type: z.string(),
    brand: z.string().nullable(),
    model: z.string().nullable(),
    serial: z.string().nullable(),
    install_date: z.iso.date().nullable(),
    warranty_end: z.iso.date().nullable(),
    notes: z.string().nullable(),
  })
  .meta({ id: "Equipment" });
export type EquipmentDto = z.infer<typeof equipmentSchema>;

export const attachmentSchema = z
  .object({
    id: z.uuid(),
    job_id: z.uuid(),
    kind: z.enum(ATTACHMENT_KINDS),
    file_name: z.string(),
    mime_type: z.string(),
    size_bytes: z.number().int(),
    tag: z.enum(ATTACHMENT_TAGS).nullable(),
    caption: z.string().nullable(),
    status: z.enum(["pending", "ready"]),
    url: z.url().nullable().meta({ description: "Short-lived signed download URL (ready attachments only)" }),
    thumbnail_url: z.url().nullable(),
    created_at: ts,
  })
  .meta({ id: "Attachment" });
export type AttachmentDto = z.infer<typeof attachmentSchema>;
