import "server-only";
import type { RecurrenceView } from "@fieldops/core";
import type { RecurrenceDto, RecurrenceStatus } from "@fieldops/shared";

/** A maintenance plan (JOB-13) as the API returns it, with its status and next visit dates. */
export function toRecurrenceDto(
  p: RecurrenceView & { status: RecurrenceStatus; upcoming: string[] },
): RecurrenceDto {
  return {
    id: p.id,
    customer: p.customer,
    site: p.site,
    equipment_id: p.equipmentId,
    service_type: p.serviceType,
    title: p.title,
    description: p.description,
    priority: p.priority,
    interval_unit: p.intervalUnit,
    interval_count: p.intervalCount,
    starts_on: p.startsOn,
    ends_on: p.endsOn,
    window_start: p.windowStart,
    window_minutes: p.windowMinutes,
    lead_days: p.leadDays,
    lead_member: p.leadMember ? { member_id: p.leadMember.memberId, name: p.leadMember.name } : null,
    status: p.status,
    next_on: p.status === "ended" ? null : p.nextOn,
    upcoming_dates: p.upcoming,
    job_count: p.jobCount,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}
