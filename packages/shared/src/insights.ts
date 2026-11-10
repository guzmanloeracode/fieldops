import { z } from "zod";
import { JOB_STATUSES, HOLD_REASONS } from "./constants";
import { optionalText, trimmed } from "./fields";

// 0.2 productivity and insights: saved views and bulk actions (JOB-04), equipment (CUS-03), dashboard (DSH).

export const savedViewCreateSchema = z
  .object({
    name: trimmed(60).min(1),
    /** URL query string of the jobs table filters. */
    query: z.string().max(2000),
    shared: z.boolean().default(false),
  })
  .meta({ id: "SavedViewCreate" });
export type SavedViewCreate = z.output<typeof savedViewCreateSchema>;

/** One action applied to many jobs. Each job is checked on its own; failures are reported per job. */
export const jobBulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    ids: z.array(z.uuid()).min(1).max(100),
    member_id: z.uuid(),
  }),
  z.object({
    action: z.literal("transition"),
    ids: z.array(z.uuid()).min(1).max(100),
    to: z.enum(JOB_STATUSES),
    reason: optionalText(500),
    hold_reason: z.enum(HOLD_REASONS).nullable().optional(),
  }),
]);
export type JobBulkAction = z.output<typeof jobBulkActionSchema>;

const optionalDate = z
  .union([z.iso.date(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const equipmentCreateSchema = z
  .object({
    type: trimmed(80).min(1),
    brand: optionalText(80),
    model: optionalText(80),
    serial: optionalText(80),
    install_date: optionalDate,
    warranty_end: optionalDate,
    notes: optionalText(2000),
  })
  .meta({ id: "EquipmentCreate" });
export type EquipmentCreate = z.output<typeof equipmentCreateSchema>;

/** Partial update without defaults. */
export const equipmentUpdateSchema = z
  .object({
    type: trimmed(80).min(1),
    brand: optionalText(80),
    model: optionalText(80),
    serial: optionalText(80),
    install_date: optionalDate,
    warranty_end: optionalDate,
    notes: optionalText(2000),
  })
  .partial()
  .meta({ id: "EquipmentUpdate" });
export type EquipmentUpdate = z.output<typeof equipmentUpdateSchema>;

export const DASHBOARD_RANGES = ["7d", "30d", "90d", "month", "last_month", "custom"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const dashboardQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default("30d"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  technician: z.uuid().optional(),
  service_type: z.uuid().optional(),
});
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;
