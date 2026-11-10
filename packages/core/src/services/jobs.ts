import {
  ALLOWED_ATTACHMENT_TYPES,
  DEMO_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_DEMO_ATTACHMENT_BYTES,
  attachmentUploadSchema,
  jobAssignmentSchema,
  jobCreateSchema,
  jobTransitionSchema,
  jobUpdateSchema,
  noteCreateSchema,
  type JobListQuery,
} from "@fieldops/shared";
import { ConflictError, NotFoundError, PreconditionFailedError, ValidationError } from "../domain/errors";
import { assertTransition, availableTransitions, findTransition } from "../domain/job-status";
import { assertCan, seesOnlyAssigned } from "../domain/permissions";
import { parseJobNumber } from "../domain/numbering";
import { assertValidWindow } from "../domain/schedule";
import { parseInput } from "./validate";
import type { JobRecord, JobView, ServiceContext } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAssigned(ctx: ServiceContext, job: Pick<JobView, "assignees">): boolean {
  return job.assignees.some((a) => a.memberId === ctx.actor.memberId);
}

export async function listJobs(ctx: ServiceContext, query: JobListQuery) {
  assertCan(ctx.actor, "jobs.view", { assigned: true });
  return ctx.store.jobs.list({
    ...query,
    ...(seesOnlyAssigned(ctx.actor) ? { assignedMemberId: ctx.actor.memberId } : {}),
  });
}

/** Loads a job by id or number ("JOB-000123"). Jobs a technician isn't assigned to are reported as not found. */
export async function getJob(ctx: ServiceContext, idOrNumber: string): Promise<JobView> {
  let job: JobView | null = null;
  if (UUID.test(idOrNumber)) job = await ctx.store.jobs.get(idOrNumber);
  else {
    const n = parseJobNumber(idOrNumber);
    if (n) job = await ctx.store.jobs.getByNumber(n);
  }
  if (!job) throw new NotFoundError("Job");
  const assigned = isAssigned(ctx, job);
  if (seesOnlyAssigned(ctx.actor) && !assigned) throw new NotFoundError("Job");
  assertCan(ctx.actor, "jobs.view", { assigned });
  return job;
}

export async function getJobActions(ctx: ServiceContext, job: JobView) {
  return availableTransitions(ctx.actor, job.status, { assigned: isAssigned(ctx, job) });
}

export async function createJob(ctx: ServiceContext, raw: unknown): Promise<JobView> {
  assertCan(ctx.actor, "jobs.create");
  const input = parseInput(jobCreateSchema, raw);
  const site = await ctx.store.sites.get(input.site_id);
  if (!site || site.customerId !== input.customer_id) {
    throw new ValidationError("The site doesn't belong to this customer", [
      { path: "site_id", message: "Choose a site of the selected customer" },
    ]);
  }
  if (input.equipment_id) {
    const eq = await ctx.store.equipment.get(input.equipment_id);
    if (!eq || eq.siteId !== site.id) {
      throw new ValidationError("The equipment isn't at this site", [
        { path: "equipment_id", message: "Not at this site" },
      ]);
    }
  }
  let estimated = input.estimated_duration_min ?? null;
  if (input.service_type_id) {
    const st = await ctx.store.serviceTypes.get(input.service_type_id);
    if (!st)
      throw new ValidationError("Unknown service type", [
        { path: "service_type_id", message: "Unknown service type" },
      ]);
    estimated ??= st.defaultDurationMin;
  }
  const number = await ctx.store.jobs.nextNumber();
  const job = await ctx.store.jobs.create({
    number,
    customerId: input.customer_id,
    siteId: input.site_id,
    equipmentId: input.equipment_id ?? null,
    serviceTypeId: input.service_type_id ?? null,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    source: input.source,
    preferredStart: input.preferred_start ? new Date(input.preferred_start) : null,
    preferredEnd: input.preferred_end ? new Date(input.preferred_end) : null,
    estimatedDurationMin: estimated,
    aiDrafted: input.source === "ai_intake",
    needsReview: input.source === "portal" || input.source === "ai_intake",
    createdBy: ctx.actor.userId,
  });
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "created",
    fromStatus: null,
    toStatus: "new",
    actorUserId: ctx.actor.userId,
    payload: { source: input.source },
  });
  return (await ctx.store.jobs.get(job.id))!;
}

export async function updateJob(ctx: ServiceContext, id: string, raw: unknown, expectedVersion?: number) {
  assertCan(ctx.actor, "jobs.update");
  const input = parseInput(jobUpdateSchema, raw);
  const current = await getJob(ctx, id);
  if (expectedVersion !== undefined && current.version !== expectedVersion)
    throw new PreconditionFailedError();

  const patch: Partial<JobRecord> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.estimated_duration_min !== undefined) patch.estimatedDurationMin = input.estimated_duration_min;
  if (input.preferred_start !== undefined)
    patch.preferredStart = input.preferred_start ? new Date(input.preferred_start) : null;
  if (input.preferred_end !== undefined)
    patch.preferredEnd = input.preferred_end ? new Date(input.preferred_end) : null;
  if (input.service_type_id !== undefined) {
    if (input.service_type_id && !(await ctx.store.serviceTypes.get(input.service_type_id))) {
      throw new ValidationError("Unknown service type", [
        { path: "service_type_id", message: "Unknown service type" },
      ]);
    }
    patch.serviceTypeId = input.service_type_id;
  }
  if (input.equipment_id !== undefined) {
    if (input.equipment_id) {
      const eq = await ctx.store.equipment.get(input.equipment_id);
      if (!eq || eq.siteId !== current.siteId) {
        throw new ValidationError("The equipment isn't at this site", [
          { path: "equipment_id", message: "Not at this site" },
        ]);
      }
    }
    patch.equipmentId = input.equipment_id;
  }
  const changed = Object.keys(patch).filter(
    (k) => String(patch[k as keyof JobRecord] ?? "") !== String(current[k as keyof JobRecord] ?? ""),
  );
  if (changed.length === 0) return current;
  const updated = await ctx.store.jobs.update(current.id, patch, current.version);
  if (!updated) throw new PreconditionFailedError();
  await ctx.store.jobs.addEvent({
    jobId: current.id,
    type: "updated",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: { fields: changed },
  });
  return (await ctx.store.jobs.get(current.id))!;
}

export async function transitionJob(ctx: ServiceContext, id: string, raw: unknown, expectedVersion?: number) {
  const input = parseInput(jobTransitionSchema, raw);
  const job = await getJob(ctx, id);
  if (expectedVersion !== undefined && job.version !== expectedVersion) throw new PreconditionFailedError();
  const rule = assertTransition(
    ctx.actor,
    job.status,
    { to: input.to, reason: input.reason, holdReason: input.hold_reason },
    {
      assigned: isAssigned(ctx, job),
      hasAssignee: job.assignees.length > 0,
      hasSchedule: Boolean(job.scheduledStart && job.scheduledEnd),
      missingRequiredItems:
        input.to === "completed" ? await ctx.store.jobs.missingRequiredChecklistItems(job.id) : [],
    },
  );

  const patch: Partial<JobRecord> = { status: rule.to };
  if (rule.name === "hold") patch.holdReason = input.hold_reason ?? null;
  if (job.status === "on_hold") patch.holdReason = null;
  if (rule.name === "complete") patch.completedAt = ctx.now;
  if (rule.name === "reopen") patch.completedAt = null;
  if (rule.name === "cancel") patch.canceledAt = ctx.now;
  if (rule.name === "unschedule") {
    patch.scheduledStart = null;
    patch.scheduledEnd = null;
  }
  if (rule.to === "in_progress" || rule.to === "completed") patch.needsReview = false;
  if (rule.to === "scheduled" && !job.firstScheduledAt) patch.firstScheduledAt = ctx.now;
  // A job that needs another visit doesn't count as a first-visit completion (DSH-01).
  if (rule.name === "reschedule" || rule.name === "reopen") patch.revisit = true;

  const updated = await ctx.store.jobs.update(job.id, patch, job.version);
  if (!updated) throw new PreconditionFailedError();
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "status_changed",
    fromStatus: job.status,
    toStatus: rule.to,
    actorUserId: ctx.actor.userId,
    payload: {
      transition: rule.name,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.hold_reason ? { hold_reason: input.hold_reason } : {}),
    },
  });
  return (await ctx.store.jobs.get(job.id))!;
}

/**
 * Assigns technicians and sets the visit window. A new job with both becomes Scheduled; a scheduled job
 * that loses either goes back to New. Overlapping visits need an override reason (SCH-03).
 */
export async function assignJob(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx.actor, "jobs.assign");
  const input = parseInput(jobAssignmentSchema, raw);
  const job = await getJob(ctx, id);
  if (job.status === "completed" || job.status === "canceled") {
    throw new ConflictError("Completed or canceled jobs can't be reassigned");
  }
  const memberIds = [...new Set(input.member_ids)];
  const members = await ctx.store.members.list();
  const known = new Set(members.map((m) => m.id));
  const unknown = memberIds.filter((m) => !known.has(m));
  if (unknown.length)
    throw new ValidationError("Unknown member", [{ path: "member_ids", message: "Unknown member" }]);

  const start = input.scheduled_start ? new Date(input.scheduled_start) : null;
  const end = input.scheduled_end ? new Date(input.scheduled_end) : null;
  if (start && end) assertValidWindow(start, end);

  if (start && end && !input.override_reason) {
    const conflicts: { memberId: string; jobs: number[] }[] = [];
    for (const memberId of memberIds) {
      const overlapping = await ctx.store.jobs.overlapping(memberId, start, end, job.id);
      if (overlapping.length) conflicts.push({ memberId, jobs: overlapping.map((j) => j.number) });
    }
    if (conflicts.length) {
      throw new ConflictError("This visit overlaps another job for the same technician", { conflicts });
    }
  }

  const lead = input.lead_member_id ?? memberIds[0] ?? null;
  await ctx.store.jobs.setAssignments(
    job.id,
    memberIds.map((memberId) => ({ memberId, isLead: memberId === lead })),
  );

  const hasAll = memberIds.length > 0 && start !== null && end !== null;
  const patch: Partial<JobRecord> = { scheduledStart: start, scheduledEnd: end };
  let toStatus = job.status;
  if (job.status === "new" && hasAll) toStatus = "scheduled";
  if (job.status === "scheduled" && !hasAll) toStatus = "new";
  if (job.status === "on_hold" && hasAll && findTransition("on_hold", "scheduled")) toStatus = "scheduled";
  if (toStatus !== job.status) patch.status = toStatus;
  if (job.status === "on_hold" && toStatus === "scheduled") {
    patch.holdReason = null;
    patch.revisit = true;
  }
  if (toStatus === "scheduled" && !job.firstScheduledAt) patch.firstScheduledAt = ctx.now;

  const updated = await ctx.store.jobs.update(job.id, patch, job.version);
  if (!updated) throw new PreconditionFailedError();
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "assigned",
    fromStatus: toStatus !== job.status ? job.status : null,
    toStatus: toStatus !== job.status ? toStatus : null,
    actorUserId: ctx.actor.userId,
    payload: {
      member_ids: memberIds,
      lead_member_id: lead,
      scheduled_start: start?.toISOString() ?? null,
      scheduled_end: end?.toISOString() ?? null,
      ...(input.override_reason ? { override_reason: input.override_reason } : {}),
    },
  });
  return (await ctx.store.jobs.get(job.id))!;
}

export async function deleteJob(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "jobs.delete");
  const job = await getJob(ctx, id);
  await ctx.store.jobs.softDelete(job.id);
}

export async function listJobEvents(ctx: ServiceContext, id: string) {
  const job = await getJob(ctx, id);
  return ctx.store.jobs.events(job.id);
}

// ------------------------------------------------------------------ notes (JOB-07)

export async function listNotes(ctx: ServiceContext, jobId: string) {
  const job = await getJob(ctx, jobId);
  return ctx.store.notes.list(job.id);
}

export async function addNote(ctx: ServiceContext, jobId: string, raw: unknown) {
  const input = parseInput(noteCreateSchema, raw);
  const job = await getJob(ctx, jobId);
  assertCan(ctx.actor, "jobs.work", { assigned: isAssigned(ctx, job) });
  const note = await ctx.store.notes.create(job.id, {
    body: input.body,
    visibility: input.visibility,
    authorUserId: ctx.actor.userId,
  });
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "note_added",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: { note_id: note.id, visibility: note.visibility },
  });
  return note;
}

// ------------------------------------------------------------------ attachments (JOB-06)

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
  return cleaned || "file";
}

export async function requestAttachmentUpload(ctx: ServiceContext, jobId: string, raw: unknown) {
  if (!ctx.files) throw new Error("File storage is not configured");
  const input = parseInput(attachmentUploadSchema, raw);
  const job = await getJob(ctx, jobId);
  assertCan(ctx.actor, "jobs.work", { assigned: isAssigned(ctx, job) });

  const allowed: readonly string[] = ctx.demo ? DEMO_ATTACHMENT_TYPES : ALLOWED_ATTACHMENT_TYPES;
  const maxBytes = ctx.demo ? MAX_DEMO_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
  if (!allowed.includes(input.mime_type)) {
    throw new ValidationError("This file type isn't allowed", [
      { path: "mime_type", message: `Allowed: ${allowed.join(", ")}` },
    ]);
  }
  if (input.size_bytes > maxBytes) {
    throw new ValidationError("The file is too large", [
      { path: "size_bytes", message: `Maximum ${Math.round(maxBytes / 1024 / 1024)} MB` },
    ]);
  }
  const attachmentId = crypto.randomUUID();
  const base = `org/${ctx.store.organizationId}/jobs/${job.id}/${attachmentId}`;
  const storageKey = `${base}/${safeFileName(input.file_name)}`;
  const thumbKey = input.with_thumbnail && input.mime_type.startsWith("image/") ? `${base}/thumb.webp` : null;
  const record = await ctx.store.attachments.create({
    jobId: job.id,
    kind: input.kind,
    storageKey,
    thumbKey,
    fileName: input.file_name,
    mimeType: input.mime_type,
    sizeBytes: input.size_bytes,
    tag: input.tag ?? null,
    caption: input.caption ?? null,
    status: "pending",
    uploadedBy: ctx.actor.userId,
  });
  const put = await ctx.files.presignPut(storageKey, input.mime_type, input.size_bytes);
  const thumb = thumbKey ? await ctx.files.presignPut(thumbKey, "image/webp") : null;
  return {
    attachment: record,
    uploadUrl: put.url,
    thumbnailUploadUrl: thumb?.url ?? null,
    headers: put.headers,
    expiresIn: put.expiresIn,
  };
}

export async function confirmAttachmentUpload(ctx: ServiceContext, attachmentId: string) {
  if (!ctx.files) throw new Error("File storage is not configured");
  const attachment = await ctx.store.attachments.get(attachmentId);
  if (!attachment) throw new NotFoundError("Attachment");
  const job = await getJob(ctx, attachment.jobId);
  assertCan(ctx.actor, "jobs.work", { assigned: isAssigned(ctx, job) });
  if (attachment.status === "ready") return attachment;
  if (!(await ctx.files.exists(attachment.storageKey))) {
    throw new ConflictError("The upload hasn't finished yet");
  }
  const ready = (await ctx.store.attachments.markReady(attachmentId))!;
  await ctx.store.jobs.addEvent({
    jobId: job.id,
    type: "attachment_added",
    fromStatus: null,
    toStatus: null,
    actorUserId: ctx.actor.userId,
    payload: { attachment_id: ready.id, kind: ready.kind, tag: ready.tag, file_name: ready.fileName },
  });
  return ready;
}

export async function listAttachments(ctx: ServiceContext, jobId: string) {
  const job = await getJob(ctx, jobId);
  const rows = (await ctx.store.attachments.list(job.id)).filter((a) => a.status === "ready");
  if (!ctx.files)
    return rows.map((a) => ({ ...a, url: null as string | null, thumbUrl: null as string | null }));
  const files = ctx.files;
  return Promise.all(
    rows.map(async (a) => ({
      ...a,
      url: await files.presignGet(a.storageKey, { downloadName: a.fileName }),
      thumbUrl: a.thumbKey ? await files.presignGet(a.thumbKey) : null,
    })),
  );
}

export async function removeAttachment(ctx: ServiceContext, attachmentId: string) {
  const attachment = await ctx.store.attachments.get(attachmentId);
  if (!attachment) throw new NotFoundError("Attachment");
  const job = await getJob(ctx, attachment.jobId);
  const own = attachment.uploadedBy === ctx.actor.userId;
  if (!own) assertCan(ctx.actor, "jobs.update");
  else assertCan(ctx.actor, "jobs.work", { assigned: isAssigned(ctx, job) });
  await ctx.store.attachments.remove(attachmentId);
  if (ctx.files)
    await ctx.files.remove([attachment.storageKey, ...(attachment.thumbKey ? [attachment.thumbKey] : [])]);
}
