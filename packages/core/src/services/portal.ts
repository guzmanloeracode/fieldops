import {
  PORTAL_LINK_TTL_MIN,
  PORTAL_MAX_DAYS_AHEAD,
  PORTAL_MAX_PHOTOS,
  PORTAL_PHOTO_TYPES,
  PORTAL_SESSION_TTL_DAYS,
  PORTAL_SLOT_MINUTES,
  portalPhotoUploadSchema,
  portalRequestSchema,
  type JobStatus,
  type PortalWindowInput,
} from "@fieldops/shared";
import { normalizeEmail } from "../domain/contact";
import { localDateOf, shiftDate, zonedInstant } from "../domain/availability";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { notify, usersWithRoles } from "./notify";
import { parseInput } from "./validate";
import type {
  PortalActor,
  PortalContactRecord,
  PortalContext,
  PortalJobEvent,
  PortalJobRow,
  PortalPhoto,
} from "./portal-types";
import type { Store } from "./types";

// Customer portal (POR-01–03). Every function takes the portal actor built from the portal session; the
// customer id in it is the only scope. Nothing here returns prices, internal notes or other customers' data.

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Sessions record their last use at most once an hour. */
const TOUCH_EVERY_MS = 60 * MINUTE;

// ------------------------------------------------------------------ sign-in (POR-01)

/** The contact a sign-in link would go to, or null. Callers answer the same way either way (no enumeration). */
export async function findPortalContact(store: Store, email: string): Promise<PortalContactRecord | null> {
  const norm = normalizeEmail(email);
  return norm ? store.portal.findContactByEmail(norm) : null;
}

/** Stores a one-time link for the contact (only the token's hash). Returns when it expires. */
export async function issuePortalLink(
  store: Store,
  contactId: string,
  tokenHash: string,
  now: Date,
): Promise<Date> {
  const expiresAt = new Date(now.getTime() + PORTAL_LINK_TTL_MIN * MINUTE);
  await store.portal.createToken({ contactId, tokenHash, expiresAt });
  return expiresAt;
}

/**
 * Uses a sign-in link and opens a session for its contact. Returns null when the link is unknown, used or
 * expired, or the contact is gone.
 */
export async function redeemPortalLink(
  store: Store,
  input: {
    linkHash: string;
    sessionHash: string;
    now: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<{ contact: PortalContactRecord; expiresAt: Date } | null> {
  const used = await store.portal.consumeToken(input.linkHash, input.now);
  if (!used) return null;
  const contact = await store.portal.getContact(used.contactId);
  if (!contact) return null;
  const expiresAt = await openPortalSession(store, { ...input, contact });
  return { contact, expiresAt };
}

/** Opens a session for a contact: after a sign-in link, or the demo's one-click sign-in. */
export async function openPortalSession(
  store: Store,
  input: {
    contact: PortalContactRecord;
    sessionHash: string;
    now: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<Date> {
  const expiresAt = new Date(input.now.getTime() + PORTAL_SESSION_TTL_DAYS * DAY);
  await store.portal.createSession({
    contactId: input.contact.id,
    customerId: input.contact.customerId,
    tokenHash: input.sessionHash,
    expiresAt,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return expiresAt;
}

/** The portal customer for a session cookie, or null. */
export async function resolvePortalSession(
  store: Store,
  sessionHash: string,
  now: Date,
): Promise<PortalActor | null> {
  const s = await store.portal.findSession(sessionHash, now);
  if (!s) return null;
  if (!s.lastSeenAt || now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await store.portal.touchSession(s.id, now);
  }
  return {
    organizationId: store.organizationId,
    customerId: s.customerId,
    customerName: s.customerName,
    contactId: s.contactId,
    contactName: s.contactName,
  };
}

export async function closePortalSession(store: Store, sessionHash: string): Promise<void> {
  await store.portal.deleteSession(sessionHash);
}

// ------------------------------------------------------------------ tracking (POR-03)

/** Customers see a technician's first name only. */
export function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export interface PortalJob extends Omit<PortalJobRow, "leadTechnicianName"> {
  technicianFirstName: string | null;
}

function toPortalJob(row: PortalJobRow): PortalJob {
  const { leadTechnicianName, ...rest } = row;
  return { ...rest, technicianFirstName: firstName(leadTechnicianName) };
}

export async function listPortalJobs(ctx: PortalContext, limit = 50): Promise<PortalJob[]> {
  return (await ctx.store.portal.listJobs(ctx.portal.customerId, limit)).map(toPortalJob);
}

/** One step of the customer-facing history. `scheduled` steps carry the visit window. */
export interface PortalStep {
  status: JobStatus;
  at: Date;
  window: { start: Date; end: Date } | null;
}

/** Reduces the job's events to what a customer cares about: received, scheduled and status changes. */
export function portalSteps(events: PortalJobEvent[]): PortalStep[] {
  const steps: PortalStep[] = [];
  for (const e of events) {
    if (e.type === "created") steps.push({ status: "new", at: e.createdAt, window: null });
    else if (
      e.type === "assigned" &&
      typeof e.payload.scheduled_start === "string" &&
      e.payload.scheduled_end
    ) {
      steps.push({
        status: "scheduled",
        at: e.createdAt,
        window: {
          start: new Date(e.payload.scheduled_start),
          end: new Date(String(e.payload.scheduled_end)),
        },
      });
    } else if (
      e.type === "status_changed" &&
      e.toStatus &&
      e.toStatus !== "new" &&
      e.toStatus !== "scheduled"
    ) {
      steps.push({ status: e.toStatus, at: e.createdAt, window: null });
    }
  }
  return steps;
}

/** The windows a portal request asked for, from its created event. */
export function requestedWindows(events: PortalJobEvent[]): { start: Date; end: Date }[] {
  const created = events.find((e) => e.type === "created");
  const raw = created?.payload.preferred_windows;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (w): w is { start: string; end: string } => typeof w?.start === "string" && typeof w?.end === "string",
    )
    .map((w) => ({ start: new Date(w.start), end: new Date(w.end) }));
}

export interface PortalJobDetail {
  job: PortalJob;
  steps: PortalStep[];
  requestedWindows: { start: Date; end: Date }[];
  notes: { body: string; createdAt: Date }[];
  photos: { id: string; fileName: string; url: string | null; thumbUrl: string | null }[];
}

export async function getPortalJob(ctx: PortalContext, number: number): Promise<PortalJobDetail> {
  const row = await ctx.store.portal.getJobByNumber(ctx.portal.customerId, number);
  if (!row) throw new NotFoundError("Job");
  const [events, notes, attachments] = await Promise.all([
    ctx.store.portal.jobEvents(row.id),
    ctx.store.portal.customerNotes(row.id),
    ctx.store.attachments.list(row.id),
  ]);
  // Only the photos this customer's contacts sent with the request; never the technicians' files.
  const prefix = portalUploadPrefix(ctx.portal.organizationId);
  const own = attachments.filter((a) => a.status === "ready" && a.storageKey.startsWith(prefix));
  const files = ctx.files;
  const photos = await Promise.all(
    own.map(async (a) => ({
      id: a.id,
      fileName: a.fileName,
      url: files ? await files.presignGet(a.storageKey) : null,
      thumbUrl: files && a.thumbKey ? await files.presignGet(a.thumbKey) : null,
    })),
  );
  return {
    job: toPortalJob(row),
    steps: portalSteps(events),
    requestedWindows: requestedWindows(events),
    notes,
    photos,
  };
}

export async function listPortalSites(ctx: PortalContext) {
  return (await ctx.store.sites.listByCustomer(ctx.portal.customerId)).map((s) => ({
    id: s.id,
    label: s.label,
    line1: s.address.line1,
    city: s.address.city,
  }));
}

// ------------------------------------------------------------------ requests (POR-02)

/** Storage keys of portal uploads start with this (org/<org>/portal/<contact>/<upload>/<file>). */
export function portalUploadPrefix(organizationId: string, contactId?: string): string {
  return `org/${organizationId}/portal/${contactId ? `${contactId}/` : ""}`;
}

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-120);
  return cleaned || "photo";
}

/** Signed upload URLs for one request photo, under the contact's own key prefix. */
export async function requestPortalPhotoUpload(ctx: PortalContext, raw: unknown) {
  if (!ctx.files) throw new ConflictError("Photo uploads aren't available right now");
  const input = parseInput(portalPhotoUploadSchema, raw);
  const base = `${portalUploadPrefix(ctx.portal.organizationId, ctx.portal.contactId)}${crypto.randomUUID()}`;
  const photo: PortalPhoto = {
    storageKey: `${base}/${safeFileName(input.file_name)}`,
    thumbKey: input.with_thumbnail ? `${base}/thumb.webp` : null,
    fileName: input.file_name,
    mimeType: input.mime_type,
    sizeBytes: input.size_bytes,
  };
  const put = await ctx.files.presignPut(photo.storageKey, photo.mimeType, photo.sizeBytes);
  const thumb = photo.thumbKey ? await ctx.files.presignPut(photo.thumbKey, "image/webp") : null;
  return { photo, uploadUrl: put.url, thumbnailUploadUrl: thumb?.url ?? null, headers: put.headers };
}

/** "AC is leaking water onto the floor…" → a short job title from the first line. */
export function titleFromDescription(description: string, fallback = "Service request"): string {
  const line =
    description
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim() ?? "";
  if (!line) return fallback;
  if (line.length <= 80) return line.replace(/[.!?,;:]+$/, "") || fallback;
  const cut = line.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[.!?,;:]+$/, "")}…`;
}

/** Converts chosen days and slots into instants in the organization's time zone, checking each is ahead. */
export function windowsToInstants(
  windows: PortalWindowInput[],
  timeZone: string,
  now: Date,
): { start: Date; end: Date }[] {
  const today = localDateOf(now, timeZone);
  const last = shiftDate(today, PORTAL_MAX_DAYS_AHEAD);
  const seen = new Set<string>();
  const out: { start: Date; end: Date }[] = [];
  windows.forEach((w, i) => {
    if (w.date < today || w.date > last) {
      throw new ValidationError("Pick a day from today up to two months ahead", [
        { path: `windows.${i}.date`, message: "Pick a day from today up to two months ahead" },
      ]);
    }
    const key = `${w.date}|${w.slot}`;
    if (seen.has(key)) return;
    seen.add(key);
    const slot = PORTAL_SLOT_MINUTES[w.slot];
    out.push({
      start: zonedInstant(w.date, slot.start, timeZone),
      end: zonedInstant(w.date, slot.end, timeZone),
    });
  });
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Creates a job from a portal request (POR-02): status New, marked "Needs review", queued for an AI draft when
 * the organization uses AI, with the customer's photos. Dispatchers are notified.
 */
export async function createPortalRequest(
  ctx: PortalContext,
  raw: unknown,
  photos: PortalPhoto[] = [],
): Promise<{ id: string; number: number }> {
  const input = parseInput(portalRequestSchema, raw);
  const { store, portal } = ctx;
  if (photos.length > PORTAL_MAX_PHOTOS) {
    throw new ValidationError(`Add up to ${PORTAL_MAX_PHOTOS} photos`, [
      { path: "photos", message: `Add up to ${PORTAL_MAX_PHOTOS} photos` },
    ]);
  }
  const prefix = portalUploadPrefix(portal.organizationId, portal.contactId);
  for (const p of photos) {
    const ownKey = (k: string | null) => k === null || (k.startsWith(prefix) && !k.includes(".."));
    if (
      !ownKey(p.storageKey) ||
      !ownKey(p.thumbKey) ||
      !(PORTAL_PHOTO_TYPES as readonly string[]).includes(p.mimeType)
    ) {
      throw new ValidationError("A photo couldn't be attached", [
        { path: "photos", message: "Upload the photo again" },
      ]);
    }
    if (ctx.files && !(await ctx.files.exists(p.storageKey))) {
      throw new ConflictError("A photo hasn't finished uploading");
    }
  }

  const org = await store.organization.get();
  const windows = windowsToInstants(input.windows, org.timezone, ctx.now);

  let siteId: string;
  if (input.site_id) {
    const site = await store.sites.get(input.site_id);
    if (!site || site.customerId !== portal.customerId) {
      throw new ValidationError("Choose one of your addresses", [
        { path: "site_id", message: "Choose one of your addresses" },
      ]);
    }
    siteId = site.id;
  } else {
    const a = input.new_site!;
    const site = await store.sites.create(portal.customerId, {
      label: a.line1,
      address: {
        line1: a.line1,
        line2: a.line2 ?? null,
        city: a.city,
        region: null,
        postal_code: a.postal_code ?? null,
        country: org.country,
      },
      latitude: null,
      longitude: null,
      accessNotes: a.access_notes ?? null,
      onsiteContactName: portal.contactName,
      onsiteContactPhone: null,
    });
    siteId = site.id;
  }

  const number = await store.jobs.nextNumber();
  const job = await store.jobs.create({
    number,
    customerId: portal.customerId,
    siteId,
    equipmentId: null,
    serviceTypeId: null,
    title: titleFromDescription(input.description),
    description: input.description,
    priority: "normal",
    source: "portal",
    preferredStart: windows[0]?.start ?? null,
    preferredEnd: windows[0]?.end ?? null,
    estimatedDurationMin: null,
    aiDrafted: false,
    needsReview: true,
    aiStatus: org.settings.ai.enabled ? "pending" : "skipped",
    createdBy: null,
  });
  await store.jobs.addEvent({
    jobId: job.id,
    type: "created",
    fromStatus: null,
    toStatus: "new",
    actorUserId: null,
    payload: {
      source: "portal",
      contact_id: portal.contactId,
      contact_name: portal.contactName,
      preferred_windows: windows.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
    },
  });
  for (const p of photos) {
    const att = await store.attachments.create({
      jobId: job.id,
      kind: "photo",
      storageKey: p.storageKey,
      thumbKey: p.thumbKey,
      fileName: p.fileName,
      mimeType: p.mimeType,
      sizeBytes: p.sizeBytes,
      tag: "before",
      caption: null,
      status: "ready",
      uploadedBy: null,
    });
    await store.jobs.addEvent({
      jobId: job.id,
      type: "attachment_added",
      fromStatus: null,
      toStatus: null,
      actorUserId: null,
      payload: {
        attachment_id: att.id,
        kind: "photo",
        tag: "before",
        file_name: p.fileName,
        contact_name: portal.contactName,
      },
    });
  }

  // Dispatchers triage portal requests; a business without one hears about it as owner or admin.
  let recipients = await usersWithRoles(store, ["dispatcher"]);
  if (recipients.length === 0) recipients = await usersWithRoles(store, ["owner", "admin"]);
  await notify(
    { store, mailer: ctx.mailer },
    {
      event: "portal_request",
      userIds: recipients,
      payload: {
        job_id: job.id,
        job_number: number,
        job_title: job.title,
        customer_name: portal.customerName,
        actor_name: portal.contactName,
      },
    },
  );
  return { id: job.id, number };
}
