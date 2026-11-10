import { z } from "zod";
import { JOB_PRIORITIES } from "./constants";
import { trimmed } from "./fields";

// AI smart intake (AI-01, PRD §9.2). The model's output is constrained to `intakeModelOutputSchema` (a JSON schema
// generated from it) and validated again on the server; `sanitizeIntakeDraft` in @fieldops/core then clamps it
// into an `IntakeDraft`. Nothing here changes data: a person confirms every field (§9.1).

/** Image types the model accepts. HEIC photos are sent as their WebP thumbnail instead. */
export const AI_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AiImageType = (typeof AI_IMAGE_TYPES)[number];
export const MAX_INTAKE_PHOTOS = 3;
/** Per photo, base64 characters (about 1.1 MB of image). The web form downsizes photos well below this. */
export const MAX_INTAKE_PHOTO_BASE64 = 1_500_000;
/** Fields below this confidence are highlighted for the dispatcher to check. */
export const LOW_CONFIDENCE = 0.6;

const nullableText = z.string().nullable();

/** What the model must return. Loose on purpose (no numeric bounds): the server clamps instead of failing. */
export const intakeModelOutputSchema = z.object({
  language: z.enum(["en", "id"]).describe("Language of the customer's message"),
  title: z.string().describe("Short job title in the message's language, at most 80 characters"),
  service_type_id: z
    .string()
    .nullable()
    .describe("The id of the best matching service type from the catalog, or null if none fits"),
  priority: z.enum(JOB_PRIORITIES),
  priority_reason: z.string().describe("One short sentence explaining the priority"),
  summary: z.string().describe("Two or three sentences for the technician: the problem and the context"),
  checklist: z.array(z.string()).describe("Up to 5 extra checks for this job beyond the standard checklist"),
  estimated_duration_min: z.number().nullable().describe("Expected time on site in minutes"),
  equipment: z.object({ type: nullableText, brand: nullableText, model: nullableText }),
  contact: z.object({ name: nullableText, phone: nullableText, email: nullableText, address: nullableText }),
  questions: z.array(z.string()).describe("Questions to ask the customer about missing information"),
  confidence: z
    .object({
      title: z.number(),
      service_type: z.number(),
      priority: z.number(),
      summary: z.number(),
      estimated_duration: z.number(),
      equipment: z.number(),
      contact: z.number(),
    })
    .describe("Confidence per field, from 0 to 1"),
});
export type IntakeModelOutput = z.infer<typeof intakeModelOutputSchema>;

export const intakeConfidenceSchema = z
  .object({
    title: z.number().min(0).max(1),
    service_type: z.number().min(0).max(1),
    priority: z.number().min(0).max(1),
    summary: z.number().min(0).max(1),
    estimated_duration: z.number().min(0).max(1),
    equipment: z.number().min(0).max(1),
    contact: z.number().min(0).max(1),
  })
  .meta({ id: "AiConfidence" });
export type IntakeConfidenceField = keyof z.infer<typeof intakeConfidenceSchema>;

/** A validated, clamped draft: service_type_id is always one of the organization's active types or null. */
export const intakeDraftSchema = z
  .object({
    language: z.enum(["en", "id"]),
    title: z.string(),
    service_type_id: z.uuid().nullable(),
    priority: z.enum(JOB_PRIORITIES),
    priority_reason: z.string(),
    summary: z.string(),
    checklist: z.array(z.string()),
    estimated_duration_min: z.number().int().nullable(),
    equipment: z.object({ type: nullableText, brand: nullableText, model: nullableText }),
    contact: z.object({
      name: nullableText,
      phone: nullableText,
      email: nullableText,
      address: nullableText,
    }),
    questions: z.array(z.string()),
    confidence: intakeConfidenceSchema,
  })
  .meta({ id: "AiIntakeDraft" });
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;

export const intakePhotoSchema = z.object({
  media_type: z.enum(AI_IMAGE_TYPES),
  data: z
    .string()
    .min(1)
    .max(MAX_INTAKE_PHOTO_BASE64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Base64 image data without a data: prefix"),
});

export const aiIntakeRequestSchema = z
  .object({
    message: trimmed(4000).min(10, "Paste the customer's message (at least 10 characters)"),
    photos: z.array(intakePhotoSchema).max(MAX_INTAKE_PHOTOS).default([]),
  })
  .meta({ id: "AiIntakeRequest" });
export type AiIntakeRequestInput = z.input<typeof aiIntakeRequestSchema>;

export const aiCustomerSuggestionSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    matched_on: z.enum(["email", "phone", "name"]),
  })
  .meta({ id: "AiCustomerSuggestion" });
export type AiCustomerSuggestion = z.infer<typeof aiCustomerSuggestionSchema>;

export const aiQuotaSchema = z
  .object({
    used: z.number().int(),
    limit: z.number().int(),
  })
  .meta({ id: "AiQuota" });

export const aiIntakeResponseSchema = z
  .object({
    status: z.enum(["drafted", "refused", "failed"]).meta({
      description:
        "`drafted`: `draft` is set. `refused` or `failed`: the model gave no usable draft; fill in the job by hand.",
    }),
    interaction_id: z.uuid().meta({ description: "The logged AI call (§9.7)" }),
    draft: intakeDraftSchema.nullable(),
    customer_suggestions: z.array(aiCustomerSuggestionSchema),
    model: z.string(),
    quota: aiQuotaSchema,
  })
  .meta({ id: "AiIntakeResult" });
export type AiIntakeResponse = z.infer<typeof aiIntakeResponseSchema>;

/** What the dispatcher did with a draft (§9.1 "Measured"). */
export const aiOutcomeSchema = z
  .object({ outcome: z.enum(["accepted", "edited", "discarded"]) })
  .meta({ id: "AiOutcome" });

/** Fields of a portal request a dispatcher can take from the AI draft while reviewing it. */
export const AI_REVIEW_FIELDS = [
  "title",
  "service_type_id",
  "priority",
  "estimated_duration_min",
  "checklist",
] as const;
export type AiReviewField = (typeof AI_REVIEW_FIELDS)[number];

export const jobReviewSchema = z
  .object({
    /** Draft fields to copy onto the job. Empty: keep the request as it is. */
    apply: z.array(z.enum(AI_REVIEW_FIELDS)).max(AI_REVIEW_FIELDS.length).default([]),
    /** Clear "Needs review". Without it, the fields are applied and the job stays in review. */
    confirm: z.boolean().default(true),
  })
  .meta({ id: "JobReview" });
export type JobReviewInput = z.input<typeof jobReviewSchema>;

/** AI settings (SET-04). */
export const aiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    monthly_quota: z.number().int().min(0).max(100_000),
  })
  .meta({ id: "AiSettings" });
