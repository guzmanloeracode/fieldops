import { z } from "zod";
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
} from "./constants";

// Inputs and API representations use snake_case, matching the public REST API (/api/v1).
// Server actions validate with the same schemas, so web, mobile and API share one contract.

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const isoDateTime = z.iso.datetime({ offset: true });

export const roleSchema = z.enum(ROLES).meta({ id: "Role" });
export const jobStatusSchema = z.enum(JOB_STATUSES).meta({ id: "JobStatus" });
export const jobPrioritySchema = z.enum(JOB_PRIORITIES).meta({ id: "JobPriority" });
export const jobSourceSchema = z.enum(JOB_SOURCES).meta({ id: "JobSource" });
export const customerTypeSchema = z.enum(CUSTOMER_TYPES).meta({ id: "CustomerType" });
export const currencySchema = z.enum(CURRENCIES).meta({ id: "Currency" });

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
  })
  .meta({ id: "CustomerCreate" });
export type CustomerCreateInput = z.input<typeof customerCreateSchema>;
export type CustomerCreate = z.output<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema
  .omit({ contacts: true })
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
    estimated_duration_min: z.number().int().min(5).max(24 * 60).nullable().optional(),
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
    estimated_duration_min: z.number().int().min(5).max(24 * 60).nullable(),
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
    with_thumbnail: z.boolean().default(false),
  })
  .meta({ id: "AttachmentUploadRequest" });
export type AttachmentUploadInput = z.output<typeof attachmentUploadSchema>;

// ---------------------------------------------------------------- organization
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
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

export const serviceTypeInputSchema = z
  .object({
    name: trimmed(120).min(1),
    description: optionalText(1000),
    default_duration_min: z.number().int().min(5).max(24 * 60).default(60),
    default_price_minor: z.number().int().min(0).default(0),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    active: z.boolean().default(true),
  })
  .meta({ id: "ServiceTypeInput" });
export type ServiceTypeInput = z.output<typeof serviceTypeInputSchema>;

export const inviteSchema = z.object({
  email: z.email().max(254).toLowerCase(),
  role: z.enum(["admin", "dispatcher", "technician"]),
});
export type InviteInput = z.output<typeof inviteSchema>;

// ---------------------------------------------------------------- list queries
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.array(z.enum(values)), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(",").filter(Boolean)))
    .pipe(z.array(z.enum(values)));

export const jobListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csvEnum(JOB_STATUSES).optional(),
  priority: csvEnum(JOB_PRIORITIES).optional(),
  technician: z.uuid().optional(),
  service_type: z.uuid().optional(),
  customer: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: z
    .string()
    .regex(/^-?(number|scheduled_start|created_at|priority|status|title)(,-?(number|scheduled_start|created_at|priority|status|title))*$/)
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
const ts = z.string().meta({ format: "date-time" });

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
    needs_review: z.boolean(),
    ai_drafted: z.boolean(),
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
    address: addressSchema,
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
    billing_address: addressSchema.nullable(),
    tags: z.array(z.string()),
    notes: z.string().nullable(),
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
      .object({ id: z.uuid(), name: z.string(), slug: z.string(), timezone: z.string(), currency: currencySchema })
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
  })
  .meta({ id: "ServiceType" });

export const problemSchema = z
  .object({
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
