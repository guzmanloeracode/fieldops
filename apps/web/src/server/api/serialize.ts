import {
  formatJobNumber,
  type AttachmentRecord,
  type ContactRecord,
  type CustomerListRow,
  type CustomerRecord,
  type EquipmentRecord,
  type JobEventRecord,
  type JobView,
  type MemberRecord,
  type NoteRecord,
  type ServiceTypeRecord,
  type SiteRecord,
  type TimeOffRecord,
  type TransitionRule,
  type schedule,
} from "@fieldops/core";
import type {
  AttachmentDto,
  CustomerDto,
  CustomerSummaryDto,
  EquipmentDto,
  JobDetailDto,
  JobDto,
  ScheduleDto,
  SiteDto,
  attachmentUploadResponseSchema,
  contactSchema,
  jobEventSchema,
  memberSchema,
  noteSchema,
  serviceTypeSchema,
  timeOffSchema,
} from "@fieldops/shared";
import type { z } from "zod";

// Maps core records (camelCase, Date) to the public snake_case representations in @fieldops/shared.

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toJobDto(j: JobView): JobDto {
  return {
    id: j.id,
    number: formatJobNumber(j.number),
    title: j.title,
    description: j.description,
    status: j.status,
    priority: j.priority,
    source: j.source,
    customer: { id: j.customer.id, name: j.customer.name },
    site: { id: j.site.id, label: j.site.label, city: j.site.address.city },
    service_type: j.serviceType ? { id: j.serviceType.id, name: j.serviceType.name } : null,
    equipment_id: j.equipmentId,
    assignees: j.assignees.map((a) => ({ member_id: a.memberId, name: a.name, is_lead: a.isLead })),
    preferred_start: iso(j.preferredStart),
    preferred_end: iso(j.preferredEnd),
    scheduled_start: iso(j.scheduledStart),
    scheduled_end: iso(j.scheduledEnd),
    completed_at: iso(j.completedAt),
    estimated_duration_min: j.estimatedDurationMin,
    hold_reason: j.holdReason,
    needs_review: j.needsReview,
    ai_drafted: j.aiDrafted,
    ai_status: j.aiStatus,
    response_due_at: iso(j.responseDueAt),
    resolution_due_at: iso(j.resolutionDueAt),
    sla_response_state: j.slaResponseState,
    sla_resolution_state: j.slaResolutionState,
    version: j.version,
    created_at: j.createdAt.toISOString(),
    updated_at: j.updatedAt.toISOString(),
  };
}

export function toJobDetailDto(j: JobView, transitions: TransitionRule[]): JobDetailDto {
  return {
    ...toJobDto(j),
    allowed_transitions: transitions.map((t) => ({
      to: t.to,
      name: t.name,
      requires_reason: Boolean(t.requiresReason),
    })),
  };
}

export function toContactDto(c: ContactRecord): z.infer<typeof contactSchema> {
  return { id: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone, is_primary: c.isPrimary };
}

export function toCustomerDto(c: CustomerRecord, contacts: ContactRecord[], siteCount: number): CustomerDto {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    billing_address: c.billingAddress,
    tags: c.tags,
    notes: c.notes,
    contacts: contacts.map(toContactDto),
    site_count: siteCount,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

export function toCustomerSummaryDto(c: CustomerListRow): CustomerSummaryDto {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    tags: c.tags,
    primary_contact: c.primaryContact,
    site_count: c.siteCount,
    open_job_count: c.openJobCount,
    last_job_at: iso(c.lastJobAt),
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

export function toSiteDto(s: SiteRecord): SiteDto {
  return {
    id: s.id,
    customer_id: s.customerId,
    label: s.label,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    access_notes: s.accessNotes,
    onsite_contact_name: s.onsiteContactName,
    onsite_contact_phone: s.onsiteContactPhone,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

export function toEquipmentDto(e: EquipmentRecord): EquipmentDto {
  return {
    id: e.id,
    site_id: e.siteId,
    type: e.type,
    brand: e.brand,
    model: e.model,
    serial: e.serial,
    install_date: e.installDate,
    warranty_end: e.warrantyEnd,
    notes: e.notes ?? null,
  };
}

export function toNoteDto(n: NoteRecord): z.infer<typeof noteSchema> {
  return {
    id: n.id,
    body: n.body,
    visibility: n.visibility,
    author: n.author,
    created_at: n.createdAt.toISOString(),
  };
}

export function toJobEventDto(e: JobEventRecord): z.infer<typeof jobEventSchema> {
  return {
    id: e.id,
    type: e.type,
    from_status: e.fromStatus,
    to_status: e.toStatus,
    actor: e.actor,
    payload: e.payload,
    created_at: e.createdAt.toISOString(),
  };
}

export function toMemberDto(m: MemberRecord): z.infer<typeof memberSchema> {
  return {
    id: m.id,
    user_id: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
    created_at: m.createdAt.toISOString(),
  };
}

export function toServiceTypeDto(s: ServiceTypeRecord): z.infer<typeof serviceTypeSchema> {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    default_duration_min: s.defaultDurationMin,
    default_price_minor: s.defaultPriceMinor,
    currency: s.currency,
    active: s.active,
    required_skills: s.requiredSkills,
    checklist_template: s.checklistTemplate.map((i) => ({
      label: i.label,
      kind: i.kind,
      unit: i.unit ?? null,
      required: i.required,
    })),
  };
}

export function toAttachmentDto(
  a: AttachmentRecord & { url?: string | null; thumbUrl?: string | null },
): AttachmentDto {
  return {
    id: a.id,
    job_id: a.jobId,
    kind: a.kind,
    file_name: a.fileName,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes,
    tag: a.tag,
    caption: a.caption,
    status: a.status,
    url: a.url ?? null,
    thumbnail_url: a.thumbUrl ?? null,
    created_at: a.createdAt.toISOString(),
  };
}

export function toUploadDto(u: {
  attachment: AttachmentRecord;
  uploadUrl: string;
  thumbnailUploadUrl: string | null;
  headers: Record<string, string>;
  expiresIn: number;
}): z.infer<typeof attachmentUploadResponseSchema> {
  return {
    attachment_id: u.attachment.id,
    upload_url: u.uploadUrl,
    thumbnail_upload_url: u.thumbnailUploadUrl,
    headers: u.headers,
    expires_in: u.expiresIn,
  };
}

// ------------------------------------------------------------------ 0.2 dispatch (SCH)

export function toTimeOffDto(t: TimeOffRecord): z.infer<typeof timeOffSchema> {
  return {
    id: t.id,
    member_id: t.memberId,
    starts_at: t.startsAt.toISOString(),
    ends_at: t.endsAt.toISOString(),
    reason: t.reason,
  };
}

export function toScheduleDto(b: schedule.Board): ScheduleDto {
  return {
    time_zone: b.timeZone,
    from: b.from,
    to: b.to,
    technicians: b.lanes.map((l) => ({
      member: { id: l.member.id, name: l.member.name, role: l.member.role, skills: l.member.skills },
      working_hours: l.workingHours,
      custom_hours: l.customHours,
      time_off: l.timeOff.map(toTimeOffDto),
    })),
    jobs: b.jobs.map(toJobDto),
  };
}
