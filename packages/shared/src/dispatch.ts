import { z } from "zod";
import { CONFLICT_KINDS } from "./constants";
import { isoDateTime, optionalText, ts } from "./fields";
import { businessHoursSchema, skillSchema } from "./schemas";

// 0.2 Dispatch: availability (SCH-04), the board (SCH-01, SCH-02), conflicts (SCH-03) and the schedule API.

/** Working hours and skills of one member. `working_hours: null` follows the organization's business hours. */
export const memberAvailabilityUpdateSchema = z
  .object({
    working_hours: businessHoursSchema.nullable(),
    skills: z.array(skillSchema).max(20),
  })
  .partial()
  .meta({ id: "MemberAvailabilityUpdate" });
export type MemberAvailabilityUpdate = z.output<typeof memberAvailabilityUpdateSchema>;

export const timeOffCreateSchema = z
  .object({
    member_id: z.uuid(),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    reason: optionalText(200),
  })
  .refine((v) => v.ends_at > v.starts_at, { message: "End must be after start", path: ["ends_at"] })
  .meta({ id: "TimeOffCreate" });
export type TimeOffCreate = z.output<typeof timeOffCreateSchema>;

/** `GET /schedule` and the board: a date range in the organization's time zone, at most 31 days. */
export const scheduleQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    member: z.uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: "`to` must not be before `from`", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 31, {
    message: "At most 31 days",
    path: ["to"],
  })
  .meta({ id: "ScheduleQuery" });
export type ScheduleQuery = z.output<typeof scheduleQuerySchema>;

export const conflictSchema = z
  .object({
    kind: z.enum(CONFLICT_KINDS),
    member_id: z.uuid(),
    member_name: z.string(),
    message: z.string(),
    job_numbers: z.array(z.string()).optional(),
    missing_skills: z.array(z.string()).optional(),
  })
  .meta({ id: "SchedulingConflict" });
export type ConflictDto = z.infer<typeof conflictSchema>;

export const timeOffSchema = z
  .object({
    id: z.uuid(),
    member_id: z.uuid(),
    starts_at: ts,
    ends_at: ts,
    reason: z.string().nullable(),
  })
  .meta({ id: "TimeOff" });
