import { z } from "zod";
import { hhmm, optionalText, queryBool, trimmed, ts } from "./fields";
import { JOB_PRIORITIES, RECURRENCE_UNITS, type Role } from "./constants";

// Maintenance plans that generate recurring jobs (JOB-13), the SLA pause (SLA-04) and the owner's daily digest
// (NOT-04). Inputs and API representations use snake_case like the rest of /api/v1.

/** How far ahead a plan creates its jobs, in days. */
export const MAX_LEAD_DAYS = 90;
/** The largest "every N" per unit: about ten years in every unit. */
export const MAX_INTERVAL_COUNT = { day: 3650, week: 520, month: 120, year: 10 } as const;
/** Dates shown in a plan's preview (the create and edit dialog, and `upcoming_dates`). */
export const PLAN_PREVIEW_COUNT = 5;

/** A plan's state: generating jobs, paused by the office, or past its last date. */
export const RECURRENCE_STATUSES = ["active", "paused", "ended"] as const;
export type RecurrenceStatus = (typeof RECURRENCE_STATUSES)[number];

const date = z.iso.date();
const unitSchema = z.enum(RECURRENCE_UNITS).meta({ id: "RecurrenceUnit" });

const planFields = {
  customer_id: z.uuid(),
  site_id: z.uuid(),
  equipment_id: z.uuid().nullable().optional(),
  service_type_id: z.uuid().nullable().optional(),
  title: trimmed(200).min(1),
  description: optionalText(8000),
  priority: z.enum(JOB_PRIORITIES),
  interval_unit: unitSchema,
  interval_count: z.number().int().min(1).max(MAX_INTERVAL_COUNT.day),
  starts_on: date.meta({ description: "First visit date, in the organization's time zone" }),
  ends_on: date.nullable().optional().meta({ description: "Last possible visit date (inclusive)" }),
  window_start: hhmm
    .nullable()
    .optional()
    .meta({ description: "Preferred visit start, local time (HH:MM)", example: "09:00" }),
  window_minutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .nullable()
    .optional()
    .meta({ description: "Length of the preferred visit window" }),
  lead_days: z.number().int().min(0).max(MAX_LEAD_DAYS),
  lead_member_id: z
    .uuid()
    .nullable()
    .optional()
    .meta({ description: "Preferred technician, suggested on each generated job (not assigned)" }),
};

type PlanShape = {
  interval_unit?: (typeof RECURRENCE_UNITS)[number];
  interval_count?: number;
  starts_on?: string;
  ends_on?: string | null;
  window_start?: string | null;
  window_minutes?: number | null;
};

const given = (x: unknown) => x !== undefined && x !== null;

/**
 * Checks shared by create and update. An update checks the fields it carries; the service checks the plan they
 * produce together with the stored values.
 */
const checkPlan = (partial: boolean) => (v: PlanShape, ctx: z.RefinementCtx) => {
  if (v.interval_unit && v.interval_count && v.interval_count > MAX_INTERVAL_COUNT[v.interval_unit]) {
    ctx.addIssue({
      code: "custom",
      path: ["interval_count"],
      message: `At most ${MAX_INTERVAL_COUNT[v.interval_unit]} for this unit`,
    });
  }
  if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) {
    ctx.addIssue({
      code: "custom",
      path: ["ends_on"],
      message: "The end date must be on or after the start",
    });
  }
  const both = !partial || (v.window_start !== undefined && v.window_minutes !== undefined);
  if (both && given(v.window_start) !== given(v.window_minutes)) {
    ctx.addIssue({
      code: "custom",
      path: [given(v.window_start) ? "window_minutes" : "window_start"],
      message: "Give the window's start and its length, or neither",
    });
  }
};

export const recurrenceCreateSchema = z
  .object({
    ...planFields,
    priority: planFields.priority.default("normal"),
    lead_days: planFields.lead_days.default(14),
  })
  .superRefine(checkPlan(false))
  .meta({ id: "RecurrenceCreate" });
export type RecurrenceCreateInput = z.input<typeof recurrenceCreateSchema>;
export type RecurrenceCreate = z.output<typeof recurrenceCreateSchema>;

/** Just the rule, for a preview of its dates before saving. */
export const recurrenceRuleSchema = z
  .object({
    interval_unit: planFields.interval_unit,
    interval_count: planFields.interval_count,
    starts_on: planFields.starts_on,
    ends_on: planFields.ends_on,
  })
  .superRefine(checkPlan(false))
  .meta({ id: "RecurrenceRule" });

const { customer_id: _customer, ...updatable } = planFields;
export const recurrenceUpdateSchema = z
  .object({
    ...updatable,
    active: z.boolean().meta({ description: "false pauses the plan; true resumes it from today" }),
  })
  .partial()
  .superRefine(checkPlan(true))
  .meta({ id: "RecurrenceUpdate" });
export type RecurrenceUpdate = z.output<typeof recurrenceUpdateSchema>;

export const recurrenceListQuerySchema = z.object({
  customer: z.uuid().optional(),
  active: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
});
export type RecurrenceListQuery = z.output<typeof recurrenceListQuerySchema>;

export const recurrenceSchema = z
  .object({
    id: z.uuid(),
    customer: z.object({ id: z.uuid(), name: z.string() }),
    site: z.object({ id: z.uuid(), label: z.string(), city: z.string() }),
    equipment_id: z.uuid().nullable(),
    service_type: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(JOB_PRIORITIES),
    interval_unit: unitSchema,
    interval_count: z.number().int(),
    starts_on: z.string().meta({ format: "date" }),
    ends_on: z.string().meta({ format: "date" }).nullable(),
    window_start: z.string().nullable(),
    window_minutes: z.number().int().nullable(),
    lead_days: z.number().int(),
    lead_member: z.object({ member_id: z.uuid(), name: z.string() }).nullable(),
    status: z.enum(RECURRENCE_STATUSES),
    next_on: z
      .string()
      .meta({ format: "date" })
      .nullable()
      .meta({ description: "The next date without a job yet; null when the plan has ended" }),
    upcoming_dates: z
      .array(z.string().meta({ format: "date" }))
      .meta({ description: "The next visit dates from today, generated or not" }),
    job_count: z.number().int().meta({ description: "Jobs the plan has generated" }),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "Recurrence" });
export type RecurrenceDto = z.infer<typeof recurrenceSchema>;

// ---------------------------------------------------------------- daily digest (NOT-04)

/** Roles offered the daily digest. Owners get it unless they turn it off; admins only when they turn it on. */
export const DIGEST_ROLES: readonly Role[] = ["owner", "admin"];
/** The local hour (organization time zone) when the digest goes out. */
export const DIGEST_LOCAL_HOUR = 7;

/** Whether a role receives the digest by default. */
export function digestByDefault(role: Role): boolean {
  return role === "owner";
}
