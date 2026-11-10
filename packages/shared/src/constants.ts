// Domain vocabulary shared by the web app, worker, API and mobile app.

export const ROLES = ["owner", "admin", "dispatcher", "technician"] as const;
export type Role = (typeof ROLES)[number];

export const JOB_STATUSES = [
  "new",
  "scheduled",
  "en_route",
  "in_progress",
  "on_hold",
  "completed",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const JOB_SOURCES = ["manual", "portal", "ai_intake", "api"] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const HOLD_REASONS = ["parts", "customer", "access", "other"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export const CUSTOMER_TYPES = ["residential", "commercial"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const NOTE_VISIBILITIES = ["internal", "customer"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const ATTACHMENT_KINDS = ["photo", "document", "signature"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_TAGS = ["before", "after"] as const;
export type AttachmentTag = (typeof ATTACHMENT_TAGS)[number];

export const CURRENCIES = ["USD", "IDR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const JOB_EVENT_TYPES = [
  "created",
  "updated",
  "status_changed",
  "assigned",
  "scheduled",
  "note_added",
  "attachment_added",
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

/** Upload limits. The demo applies the stricter image limit (DEM-05). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DEMO_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;
export const DEMO_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const INVITATION_TTL_DAYS = 7;
export const PAGE_SIZES = [25, 50, 100] as const;
