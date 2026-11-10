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
  "checklist_updated",
  "time_edited",
  "signature_captured",
  "expense_requested",
  "expense_decided",
  "part_used",
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

// ---------------------------------------------------------------- 0.2 Dispatch

/** Checklist item kinds (JOB-08). A "photo" item is done when a photo of this job is linked to it. */
export const CHECKLIST_ITEM_KINDS = ["checkbox", "number", "text", "photo"] as const;
export type ChecklistItemKind = (typeof CHECKLIST_ITEM_KINDS)[number];

/** Time entries recorded from status changes (TEC-04). */
export const TIME_ENTRY_KINDS = ["travel", "work"] as const;
export type TimeEntryKind = (typeof TIME_ENTRY_KINDS)[number];

export const EXPENSE_KINDS = ["part", "expense"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const EXPENSE_STATUSES = ["pending", "approved", "rejected"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/** Scheduling conflicts a dispatcher can override with a reason (SCH-03). */
export const CONFLICT_KINDS = ["overlap", "outside_hours", "time_off", "missing_skills"] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/** Skills a technician can have and a service type can require. Free text in the database; these are suggestions. */
export const SUGGESTED_SKILLS = ["ac", "install", "refrigerant", "duct", "cleaning", "electrical"] as const;

/**
 * Provisional response and resolution targets per priority, in minutes. KPIs use them until SLA policies
 * (SLA-01) arrive in 0.3 and store real deadlines on each job.
 */
export const DEFAULT_SLA_TARGETS: Record<JobPriority, { responseMin: number; resolutionMin: number }> = {
  urgent: { responseMin: 2 * 60, resolutionMin: 24 * 60 },
  high: { responseMin: 8 * 60, resolutionMin: 3 * 24 * 60 },
  normal: { responseMin: 24 * 60, resolutionMin: 7 * 24 * 60 },
  low: { responseMin: 3 * 24 * 60, resolutionMin: 14 * 24 * 60 },
};

/** Default approval thresholds per currency, in minor units (EXP-02). Organizations can change them. */
export const DEFAULT_APPROVAL_THRESHOLDS: Record<
  Currency,
  { autoApproveBelowMinor: number; dispatcherLimitMinor: number }
> = {
  USD: { autoApproveBelowMinor: 50_00, dispatcherLimitMinor: 250_00 },
  IDR: { autoApproveBelowMinor: 500_000_00, dispatcherLimitMinor: 2_500_000_00 },
};

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
