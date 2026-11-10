import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { world } from "../test/fixtures";
import { portalMemoryOf } from "../test/memory-portal";
import { fakeFiles, uuid } from "../test/memory-store";
import * as jobs from "./jobs";
import * as portal from "./portal";
import type { NotificationMailer } from "./notification-types";
import type { PortalContext } from "./portal-types";

type World = ReturnType<typeof world>;
const NOW = new Date("2026-11-10T15:00:00Z");

function setup(extra: Partial<PortalContext> = {}) {
  const w = world();
  const contact = w.data.contacts.find((c) => c.customerId === w.customerId)!;
  const ctx: PortalContext = {
    portal: {
      organizationId: w.store.organizationId,
      customerId: w.customerId,
      customerName: "Cara Customer",
      contactId: contact.id,
      contactName: contact.name,
    },
    store: w.store,
    now: NOW,
    demo: false,
    ...extra,
  };
  return { w, ctx, contact };
}

const request = (extra: Record<string, unknown> = {}) => ({
  description: "The AC in the bedroom is dripping water.\nIt started yesterday.",
  windows: [{ date: "2026-11-12", slot: "morning" }],
  ...extra,
});

async function scheduledJob(w: World) {
  const j = await jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "Yearly maintenance",
  });
  return jobs.assignJob(w.ctx(w.dispatcher), j.id, {
    member_ids: [w.tom.id],
    scheduled_start: "2026-11-13T15:00:00.000Z",
    scheduled_end: "2026-11-13T17:00:00.000Z",
  });
}

describe("portal sign-in (POR-01)", () => {
  it("finds a contact by email, whatever the case and spacing", async () => {
    const { w, contact } = setup();
    expect(await portal.findPortalContact(w.store, "  CARA@example.com ")).toMatchObject({
      id: contact.id,
      customerId: w.customerId,
      customerName: "Cara Customer",
    });
    expect(await portal.findPortalContact(w.store, "nobody@example.com")).toBeNull();
    expect(await portal.findPortalContact(w.store, "   ")).toBeNull();
    w.data.customers.find((c) => c.id === w.customerId)!.deleted = true;
    expect(await portal.findPortalContact(w.store, "cara@example.com")).toBeNull();
  });

  it("redeems a link once, before it expires, and opens a 30-day session", async () => {
    const { w, contact } = setup();
    const expires = await portal.issuePortalLink(w.store, contact.id, "link-1", NOW);
    expect(expires.toISOString()).toBe("2026-11-10T15:15:00.000Z");
    const input = { linkHash: "link-1", sessionHash: "sess-1", now: NOW, ip: "203.0.113.9", userAgent: "UA" };
    const first = await portal.redeemPortalLink(w.store, input);
    expect(first?.contact.id).toBe(contact.id);
    expect(first?.expiresAt.toISOString()).toBe("2026-12-10T15:00:00.000Z");
    expect(await portal.redeemPortalLink(w.store, { ...input, sessionHash: "sess-2" })).toBeNull();
    expect(portalMemoryOf(w.data).sessions).toHaveLength(1);
    expect(portalMemoryOf(w.data).sessions[0]).toMatchObject({ ip: "203.0.113.9", userAgent: "UA" });

    await portal.issuePortalLink(w.store, contact.id, "link-2", NOW);
    const late = new Date(NOW.getTime() + 16 * 60_000);
    expect(await portal.redeemPortalLink(w.store, { ...input, linkHash: "link-2", now: late })).toBeNull();
  });

  it("won't open a session when the contact disappeared after the link was sent", async () => {
    const { w, contact } = setup();
    await portal.issuePortalLink(w.store, contact.id, "link-x", NOW);
    w.data.contacts = w.data.contacts.filter((c) => c.id !== contact.id);
    expect(
      await portal.redeemPortalLink(w.store, {
        linkHash: "link-x",
        sessionHash: "s",
        now: NOW,
        ip: null,
        userAgent: null,
      }),
    ).toBeNull();
  });

  it("resolves a session to the portal actor, touching it at most hourly, until it expires or closes", async () => {
    const { w, contact } = setup();
    const c = (await portal.findPortalContact(w.store, "cara@example.com"))!;
    await portal.openPortalSession(w.store, {
      contact: c,
      sessionHash: "h",
      now: NOW,
      ip: null,
      userAgent: null,
    });
    const actor = await portal.resolvePortalSession(w.store, "h", NOW);
    expect(actor).toEqual({
      organizationId: w.store.organizationId,
      customerId: w.customerId,
      customerName: "Cara Customer",
      contactId: contact.id,
      contactName: contact.name,
    });
    const state = portalMemoryOf(w.data).sessions[0]!;
    expect(state.lastSeenAt).toEqual(NOW);
    const soon = new Date(NOW.getTime() + 10 * 60_000);
    await portal.resolvePortalSession(w.store, "h", soon);
    expect(state.lastSeenAt).toEqual(NOW);
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    await portal.resolvePortalSession(w.store, "h", later);
    expect(state.lastSeenAt).toEqual(later);
    expect(await portal.resolvePortalSession(w.store, "h", new Date("2026-12-11T00:00:00Z"))).toBeNull();
    await portal.closePortalSession(w.store, "h");
    expect(await portal.resolvePortalSession(w.store, "h", NOW)).toBeNull();
    expect(await portal.resolvePortalSession(w.store, "unknown", NOW)).toBeNull();
  });
});

describe("portal job tracking (POR-03)", () => {
  it("lists only the customer's jobs, open ones first, with the technician's first name", async () => {
    const { w, ctx } = setup();
    const done = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Old repair",
    });
    w.data.jobs.find((j) => j.id === done.id)!.status = "completed";
    const open = await scheduledJob(w);
    await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.otherCustomerId,
      site_id: w.otherSiteId,
      title: "Someone else's job",
    });
    const list = await portal.listPortalJobs(ctx);
    expect(list.map((j) => j.title)).toEqual(["Yearly maintenance", "Old repair"]);
    expect(list[0]).toMatchObject({ id: open.id, technicianFirstName: "Tom", site: { label: "Home" } });
    expect(list[0]).not.toHaveProperty("leadTechnicianName");
    expect(list[1]!.technicianFirstName).toBeNull();
  });

  it("shows one job with customer-facing steps, the customer's notes and request photos only", async () => {
    const { w, ctx } = setup({ files: fakeFiles() });
    const j = await scheduledJob(w);
    await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "en_route" });
    await jobs.addNote(w.ctx(w.tom), j.id, { body: "On my way", visibility: "customer" });
    await jobs.addNote(w.ctx(w.tom), j.id, { body: "Internal only", visibility: "internal" });
    const prefix = portal.portalUploadPrefix(w.store.organizationId, ctx.portal.contactId);
    const base = {
      jobId: j.id,
      kind: "photo" as const,
      mimeType: "image/jpeg",
      sizeBytes: 10,
      tag: null,
      caption: null,
      uploadedBy: null,
    };
    w.data.attachments.push(
      {
        ...base,
        id: uuid(),
        storageKey: `${prefix}u1/a.jpg`,
        thumbKey: `${prefix}u1/thumb.webp`,
        fileName: "a.jpg",
        status: "ready",
        createdAt: NOW,
      },
      {
        ...base,
        id: uuid(),
        storageKey: `${prefix}u2/b.jpg`,
        thumbKey: null,
        fileName: "b.jpg",
        status: "ready",
        createdAt: NOW,
      },
      {
        ...base,
        id: uuid(),
        storageKey: `org/x/jobs/${j.id}/t/tech.jpg`,
        thumbKey: null,
        fileName: "tech.jpg",
        status: "ready",
        createdAt: NOW,
      },
    );
    const detail = await portal.getPortalJob(ctx, j.number);
    expect(detail.job.technicianFirstName).toBe("Tom");
    expect(detail.steps.map((s) => s.status)).toEqual(["new", "scheduled", "en_route"]);
    expect(detail.steps[1]!.window?.start.toISOString()).toBe("2026-11-13T15:00:00.000Z");
    expect(detail.notes.map((n) => n.body)).toEqual(["On my way"]);
    expect(detail.photos.map((p) => [p.fileName, Boolean(p.url), Boolean(p.thumbUrl)])).toEqual([
      ["a.jpg", true, true],
      ["b.jpg", true, false],
    ]);
    expect(detail.requestedWindows).toEqual([]);

    const noFiles = await portal.getPortalJob({ ...ctx, files: undefined }, j.number);
    expect(noFiles.photos.every((p) => p.url === null && p.thumbUrl === null)).toBe(true);
  });

  it("answers not found for another customer's job", async () => {
    const { w, ctx } = setup();
    const other = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.otherCustomerId,
      site_id: w.otherSiteId,
      title: "Not yours",
    });
    await expect(portal.getPortalJob(ctx, other.number)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("turns events into steps and reads requested windows defensively", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 10, h));
    const events = [
      {
        type: "created" as const,
        toStatus: "new" as const,
        payload: {
          preferred_windows: [{ start: at(14).toISOString(), end: at(18).toISOString() }, { start: 1 }],
        },
        createdAt: at(1),
      },
      { type: "assigned" as const, toStatus: "scheduled" as const, payload: {}, createdAt: at(2) },
      { type: "status_changed" as const, toStatus: "new" as const, payload: {}, createdAt: at(3) },
      { type: "status_changed" as const, toStatus: "on_hold" as const, payload: {}, createdAt: at(4) },
      { type: "status_changed" as const, toStatus: null, payload: {}, createdAt: at(5) },
    ];
    expect(portal.portalSteps(events).map((s) => s.status)).toEqual(["new", "on_hold"]);
    expect(portal.requestedWindows(events)).toEqual([{ start: at(14), end: at(18) }]);
    expect(portal.requestedWindows(events.slice(1))).toEqual([]);
    expect(portal.requestedWindows([{ ...events[0]!, payload: { preferred_windows: "x" } }])).toEqual([]);
  });

  it("lists the customer's sites for the request form", async () => {
    const { ctx } = setup();
    expect(await portal.listPortalSites(ctx)).toEqual([
      { id: expect.any(String), label: "Home", line1: expect.any(String), city: expect.any(String) },
    ]);
  });

  it("keeps a technician's first name only", () => {
    expect(portal.firstName("Tom Tech")).toBe("Tom");
    expect(portal.firstName("  ")).toBeNull();
    expect(portal.firstName(null)).toBeNull();
  });
});

describe("portal requests (POR-02)", () => {
  it("derives a short title from the first line", () => {
    expect(portal.titleFromDescription("AC is leaking.\nSince Monday")).toBe("AC is leaking");
    expect(portal.titleFromDescription("\n\n  Noisy outdoor unit!!  ")).toBe("Noisy outdoor unit");
    expect(portal.titleFromDescription("   ")).toBe("Service request");
    expect(portal.titleFromDescription("...")).toBe("Service request");
    const long =
      "The air conditioner in the upstairs bedroom makes a loud rattling noise every time it starts up";
    const title = portal.titleFromDescription(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(portal.titleFromDescription("x".repeat(100))).toBe(`${"x".repeat(80)}…`);
  });

  it("turns days and slots into windows in the organization's time zone", () => {
    const tz = "America/Chicago";
    const w = portal.windowsToInstants(
      [
        { date: "2026-11-12", slot: "afternoon" },
        { date: "2026-11-11", slot: "morning" },
        { date: "2026-11-11", slot: "morning" },
        { date: "2026-11-10", slot: "anytime" },
      ],
      tz,
      NOW,
    );
    expect(w.map((x) => [x.start.toISOString(), x.end.toISOString()])).toEqual([
      ["2026-11-10T14:00:00.000Z", "2026-11-10T23:00:00.000Z"],
      ["2026-11-11T14:00:00.000Z", "2026-11-11T18:00:00.000Z"],
      ["2026-11-12T18:00:00.000Z", "2026-11-12T23:00:00.000Z"],
    ]);
    expect(() => portal.windowsToInstants([{ date: "2026-11-09", slot: "morning" }], tz, NOW)).toThrow(
      ValidationError,
    );
    expect(() => portal.windowsToInstants([{ date: "2027-02-01", slot: "morning" }], tz, NOW)).toThrow(
      /two months/,
    );
  });

  it("issues signed upload URLs under the contact's own prefix", async () => {
    const { ctx } = setup({ files: fakeFiles() });
    const up = await portal.requestPortalPhotoUpload(ctx, {
      file_name: "leak photo (1).jpg",
      mime_type: "image/jpeg",
      size_bytes: 1000,
      with_thumbnail: true,
    });
    const prefix = portal.portalUploadPrefix(ctx.portal.organizationId, ctx.portal.contactId);
    expect(up.photo.storageKey.startsWith(prefix)).toBe(true);
    expect(up.photo.storageKey.endsWith("/leak-photo-1-.jpg")).toBe(true);
    expect(up.photo.thumbKey?.endsWith("/thumb.webp")).toBe(true);
    expect(up.thumbnailUploadUrl).toContain("thumb.webp");
    const plain = await portal.requestPortalPhotoUpload(ctx, {
      file_name: "!!!",
      mime_type: "image/png",
      size_bytes: 5,
    });
    expect(plain.photo.thumbKey).toBeNull();
    expect(plain.photo.storageKey.endsWith("/photo")).toBe(true);
    expect(plain.thumbnailUploadUrl).toBeNull();
    await expect(
      portal.requestPortalPhotoUpload(ctx, {
        file_name: "a.pdf",
        mime_type: "application/pdf",
        size_bytes: 5,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      portal.requestPortalPhotoUpload(
        { ...ctx, files: undefined },
        { file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 5 },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("creates a New job that needs review, queued for an AI draft, and notifies the dispatchers", async () => {
    const sent: string[] = [];
    const mailer: NotificationMailer = {
      async send(i) {
        sent.push(i.userId);
      },
    };
    const files = fakeFiles();
    const { w, ctx, contact } = setup({ files, mailer });
    const up = await portal.requestPortalPhotoUpload(ctx, {
      file_name: "leak.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1000,
      with_thumbnail: true,
    });
    files.existing.add(up.photo.storageKey);
    const created = await portal.createPortalRequest(
      ctx,
      request({
        site_id: w.siteId,
        windows: [
          { date: "2026-11-12", slot: "afternoon" },
          { date: "2026-11-11", slot: "morning" },
        ],
      }),
      [up.photo],
    );
    const job = w.data.jobs.find((j) => j.id === created.id)!;
    expect(job).toMatchObject({
      number: created.number,
      title: "The AC in the bedroom is dripping water",
      status: "new",
      priority: "normal",
      source: "portal",
      needsReview: true,
      aiStatus: "pending",
      createdBy: null,
      siteId: w.siteId,
    });
    expect(job.preferredStart?.toISOString()).toBe("2026-11-11T08:00:00.000Z");
    const events = w.data.events.filter((e) => e.jobId === job.id);
    expect(events.map((e) => e.type)).toEqual(["created", "attachment_added"]);
    expect(events[0]!.payload).toMatchObject({
      source: "portal",
      contact_id: contact.id,
      contact_name: contact.name,
      preferred_windows: [
        { start: "2026-11-11T08:00:00.000Z", end: "2026-11-11T12:00:00.000Z" },
        { start: "2026-11-12T12:00:00.000Z", end: "2026-11-12T17:00:00.000Z" },
      ],
    });
    expect(w.data.attachments.filter((a) => a.jobId === job.id)).toEqual([
      expect.objectContaining({ kind: "photo", status: "ready", tag: "before", thumbKey: up.photo.thumbKey }),
    ]);
    const notes = w.data.automate!.notifications;
    expect(notes.map((n) => [n.userId, n.type])).toEqual([[w.dispatcher.userId, "portal_request"]]);
    expect(notes[0]!.payload).toMatchObject({ job_number: created.number, customer_name: "Cara Customer" });
    expect(sent).toEqual([w.dispatcher.userId]);
  });

  it("adds a new address, skips AI when it's off, and falls back to owners and admins without dispatchers", async () => {
    const { w, ctx } = setup();
    w.data.org.settings.ai.enabled = false;
    w.data.members = w.data.members.filter((m) => m.role !== "dispatcher");
    const created = await portal.createPortalRequest(
      ctx,
      request({ new_site: { line1: "77 Elm St", city: "Austin", line2: "", postal_code: "78701" } }),
    );
    const job = w.data.jobs.find((j) => j.id === created.id)!;
    expect(job.aiStatus).toBe("skipped");
    const site = w.data.sites.find((s) => s.id === job.siteId)!;
    expect(site).toMatchObject({
      customerId: w.customerId,
      label: "77 Elm St",
      onsiteContactName: ctx.portal.contactName,
      address: { line1: "77 Elm St", line2: null, city: "Austin", postal_code: "78701", country: "US" },
    });
    expect(w.data.automate!.notifications.map((n) => n.userId).sort()).toEqual(
      [w.owner.userId, w.admin.userId].sort(),
    );
  });

  it("rejects another customer's site, missing or doubled addresses, and foreign or unfinished photos", async () => {
    const files = fakeFiles();
    const { w, ctx } = setup({ files });
    await expect(portal.createPortalRequest(ctx, request({ site_id: w.otherSiteId }))).rejects.toThrow(
      "Choose one of your addresses",
    );
    await expect(portal.createPortalRequest(ctx, request())).rejects.toBeInstanceOf(ValidationError);
    await expect(
      portal.createPortalRequest(ctx, request({ site_id: w.siteId, new_site: { line1: "x", city: "y" } })),
    ).rejects.toBeInstanceOf(ValidationError);
    const prefix = portal.portalUploadPrefix(ctx.portal.organizationId, ctx.portal.contactId);
    const photo = (key: string, extra = {}) => ({
      storageKey: key,
      thumbKey: null,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 5,
      ...extra,
    });
    const ok = request({ site_id: w.siteId });
    await expect(
      portal.createPortalRequest(ctx, ok, [
        photo(`${prefix}1/a.jpg`),
        photo(`${prefix}2/a.jpg`),
        photo(`${prefix}3/a.jpg`),
        photo(`${prefix}4/a.jpg`),
      ]),
    ).rejects.toThrow("Add up to 3 photos");
    await expect(portal.createPortalRequest(ctx, ok, [photo("org/other/portal/x/1/a.jpg")])).rejects.toThrow(
      "A photo couldn't be attached",
    );
    await expect(portal.createPortalRequest(ctx, ok, [photo(`${prefix}../a.jpg`)])).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      portal.createPortalRequest(ctx, ok, [photo(`${prefix}1/a.jpg`, { thumbKey: "org/evil/thumb.webp" })]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      portal.createPortalRequest(ctx, ok, [photo(`${prefix}1/a.pdf`, { mimeType: "application/pdf" })]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(portal.createPortalRequest(ctx, ok, [photo(`${prefix}1/a.jpg`)])).rejects.toBeInstanceOf(
      ConflictError,
    );
    // Without file storage the existence check is skipped (nothing could have been uploaded anyway).
    const noFiles = await portal.createPortalRequest({ ...ctx, files: undefined }, ok, []);
    expect(noFiles.number).toBeGreaterThan(0);
    expect(w.data.jobs.filter((j) => j.source === "portal")).toHaveLength(1);
  });
});
