import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../domain/errors";
import { InvalidTransitionError } from "../domain/job-status";
import { formatJobNumber } from "../domain/numbering";
import { iso, world } from "../test/fixtures";
import { fakeFiles, uuid } from "../test/memory-store";
import * as jobs from "./jobs";

async function newJob(w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) {
  return jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC leaking",
    ...extra,
  });
}
async function scheduled(w: ReturnType<typeof world>, memberIds = [w.tom.id]) {
  const j = await newJob(w);
  return jobs.assignJob(w.ctx(w.dispatcher), j.id, {
    member_ids: memberIds,
    scheduled_start: iso(9),
    scheduled_end: iso(11),
  });
}

describe("createJob", () => {
  it("creates a numbered job with a created event and defaults", async () => {
    const w = world();
    const a = await newJob(w, {
      service_type_id: w.serviceTypeId,
      equipment_id: w.equipmentId,
      preferred_start: iso(8),
      preferred_end: iso(12),
    });
    const b = await newJob(w, { estimated_duration_min: 45 });
    expect(a).toMatchObject({
      number: 1,
      status: "new",
      priority: "normal",
      source: "manual",
      estimatedDurationMin: 120,
      needsReview: false,
      aiDrafted: false,
    });
    expect(a.serviceType).toEqual({ id: w.serviceTypeId, name: "AC repair" });
    expect(a.preferredStart?.toISOString()).toBe(iso(8));
    expect(b).toMatchObject({ number: 2, estimatedDurationMin: 45 });
    expect(w.data.events.filter((e) => e.jobId === a.id).map((e) => e.type)).toEqual(["created"]);
    expect(a.createdBy).toBe(w.dispatcher.userId);
  });

  it("flags portal requests for review and marks AI drafts", async () => {
    const w = world();
    expect(await newJob(w, { source: "portal" })).toMatchObject({ needsReview: true, aiDrafted: false });
    expect(await newJob(w, { source: "ai_intake" })).toMatchObject({ needsReview: false, aiDrafted: true });
  });

  it("leaves the quote and recurring sources to approved quotes and maintenance plans", async () => {
    const w = world();
    await expect(newJob(w, { source: "quote" })).rejects.toBeInstanceOf(ValidationError);
    await expect(newJob(w, { source: "recurring" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("checks that the site, equipment and service type belong together", async () => {
    const w = world();
    await expect(newJob(w, { site_id: w.otherSiteId })).rejects.toMatchObject({
      fields: [{ path: "site_id", message: expect.any(String) }],
    });
    await expect(newJob(w, { site_id: uuid().replace(/^0+/, "a") })).rejects.toBeInstanceOf(ValidationError);
    w.data.equipment.push({
      id: "00000000-0000-4000-8000-0000000000ff",
      siteId: w.otherSiteId,
      type: "x",
      brand: null,
      model: null,
      serial: null,
      installDate: null,
      warrantyEnd: null,
    });
    await expect(newJob(w, { equipment_id: "00000000-0000-4000-8000-0000000000ff" })).rejects.toMatchObject({
      fields: [{ path: "equipment_id" }],
    });
    await expect(
      newJob(w, { service_type_id: "00000000-0000-4000-8000-0000000000fe" }),
    ).rejects.toMatchObject({ fields: [{ path: "service_type_id" }] });
    await expect(newJob(w, { preferred_start: iso(12), preferred_end: iso(8) })).rejects.toMatchObject({
      fields: [{ path: "preferred_end" }],
    });
  });

  it("is closed to technicians", async () => {
    const w = world();
    await expect(
      jobs.createJob(w.ctx(w.tom), { customer_id: w.customerId, site_id: w.siteId, title: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getJob and listJobs", () => {
  it("loads by id or number", async () => {
    const w = world();
    const j = await newJob(w);
    expect((await jobs.getJob(w.ctx(w.owner), j.id)).id).toBe(j.id);
    expect((await jobs.getJob(w.ctx(w.owner), "JOB-000001")).id).toBe(j.id);
    expect((await jobs.getJob(w.ctx(w.owner), "1")).id).toBe(j.id);
    await expect(jobs.getJob(w.ctx(w.owner), "JOB-000099")).rejects.toBeInstanceOf(NotFoundError);
    await expect(jobs.getJob(w.ctx(w.owner), "nonsense")).rejects.toBeInstanceOf(NotFoundError);
    await expect(jobs.getJob(w.ctx(w.owner), "00000000-0000-4000-8000-00000000abcd")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("hides unassigned jobs from technicians as not found", async () => {
    const w = world();
    const j = await scheduled(w);
    expect((await jobs.getJob(w.ctx(w.tom), j.id)).id).toBe(j.id);
    await expect(jobs.getJob(w.ctx(w.rina), j.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await jobs.listJobs(w.ctx(w.tom), { sort: "-created_at", limit: 50 })).rows).toHaveLength(1);
    expect((await jobs.listJobs(w.ctx(w.rina), { sort: "-created_at", limit: 50 })).rows).toHaveLength(0);
    expect((await jobs.listJobs(w.ctx(w.dispatcher), { sort: "-created_at", limit: 50 })).rows).toHaveLength(
      1,
    );
  });

  it("lists the moves the actor can make", async () => {
    const w = world();
    const j = await scheduled(w);
    expect((await jobs.getJobActions(w.ctx(w.tom), j)).map((t) => t.name)).toEqual(["depart", "start"]);
    expect((await jobs.getJobActions(w.ctx(w.dispatcher), j)).map((t) => t.name)).toContain("cancel");
  });
});

describe("updateJob", () => {
  it("records changed fields and bumps the version", async () => {
    const w = world();
    const j = await newJob(w);
    const u = await jobs.updateJob(
      w.ctx(w.dispatcher),
      j.id,
      {
        title: "AC leaking badly",
        priority: "high",
        description: "",
        estimated_duration_min: 60,
        preferred_start: iso(8),
        preferred_end: null,
        service_type_id: w.serviceTypeId,
        equipment_id: w.equipmentId,
      },
      j.version,
    );
    expect(u).toMatchObject({
      title: "AC leaking badly",
      priority: "high",
      description: null,
      version: 2,
      equipmentId: w.equipmentId,
    });
    const ev = w.data.events.find((e) => e.type === "updated")!;
    expect(ev.payload.fields).toEqual(
      expect.arrayContaining(["title", "priority", "serviceTypeId", "equipmentId", "preferredStart"]),
    );
    expect(ev.payload.fields).not.toContain("description");
  });

  it("does nothing when nothing changed", async () => {
    const w = world();
    const j = await newJob(w);
    const u = await jobs.updateJob(w.ctx(w.dispatcher), j.id, { title: "AC leaking" });
    expect(u.version).toBe(1);
    expect(w.data.events.some((e) => e.type === "updated")).toBe(false);
  });

  it("rejects a stale version with 412", async () => {
    const w = world();
    const j = await newJob(w);
    await jobs.updateJob(w.ctx(w.dispatcher), j.id, { title: "v2" });
    await expect(jobs.updateJob(w.ctx(w.dispatcher), j.id, { title: "v3" }, 1)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it("validates references and permissions", async () => {
    const w = world();
    const j = await newJob(w);
    await expect(
      jobs.updateJob(w.ctx(w.dispatcher), j.id, { service_type_id: "00000000-0000-4000-8000-0000000000fe" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      jobs.updateJob(w.ctx(w.dispatcher), j.id, { equipment_id: "00000000-0000-4000-8000-0000000000fe" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await jobs.updateJob(w.ctx(w.dispatcher), j.id, { service_type_id: null, equipment_id: null }))
        .version,
    ).toBe(1);
    await expect(jobs.updateJob(w.ctx(w.tom), j.id, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("transitionJob", () => {
  it("walks the happy path with side effects and events", async () => {
    const w = world();
    let j = await scheduled(w);
    expect(j.status).toBe("scheduled");
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "en_route" });
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, {
      to: "on_hold",
      reason: "Need a fan motor",
      hold_reason: "parts",
    });
    expect(j).toMatchObject({ status: "on_hold", holdReason: "parts" });
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    expect(j.holdReason).toBeNull();
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" }, j.version);
    expect(j.status).toBe("completed");
    expect(j.completedAt?.toISOString()).toBe("2026-11-10T09:00:00.000Z");
    const changes = w.data.events
      .filter((e) => e.type === "status_changed")
      .map((e) => `${e.fromStatus}>${e.toStatus}`);
    expect(changes).toEqual([
      "scheduled>en_route",
      "en_route>in_progress",
      "in_progress>on_hold",
      "on_hold>in_progress",
      "in_progress>completed",
    ]);
    const hold = w.data.events.find((e) => e.toStatus === "on_hold")!;
    expect(hold.payload).toEqual({ transition: "hold", reason: "Need a fan motor", hold_reason: "parts" });
  });

  it("reopens with a reason (office only) and clears completedAt", async () => {
    const w = world();
    let j = await scheduled(w);
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" });
    await expect(
      jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress", reason: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "in_progress" })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    j = await jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "in_progress", reason: "Still leaking" });
    expect(j).toMatchObject({ status: "in_progress", completedAt: null });
  });

  it("cancels with a timestamp and unschedules by clearing the window", async () => {
    const w = world();
    let j = await scheduled(w);
    j = await jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "new" });
    expect(j).toMatchObject({ status: "new", scheduledStart: null, scheduledEnd: null });
    j = await jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "canceled", reason: "Customer canceled" });
    expect(j.status).toBe("canceled");
    expect(j.canceledAt).toEqual(new Date("2026-11-10T09:00:00Z"));
  });

  it("clears the review flag once work starts", async () => {
    const w = world();
    const j = await newJob(w, { source: "portal" });
    await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(9),
      scheduled_end: iso(10),
    });
    const started = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    expect(started.needsReview).toBe(false);
  });

  it("refuses to complete with required checklist items open", async () => {
    const w = world();
    let j = await scheduled(w);
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    w.data.checklist.push({ jobId: j.id, label: "Before photo", required: true, done: false });
    await expect(jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" })).rejects.toMatchObject({
      details: { missing: ["Before photo"] },
    });
  });

  it("rejects a stale version and moves by unassigned technicians", async () => {
    const w = world();
    const j = await scheduled(w);
    await expect(jobs.transitionJob(w.ctx(w.tom), j.id, { to: "en_route" }, 99)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await expect(jobs.transitionJob(w.ctx(w.rina), j.id, { to: "en_route" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("reports a concurrent change as 412", async () => {
    const w = world();
    const j = await scheduled(w);
    const original = w.store.jobs.update;
    w.store.jobs.update = async () => null;
    await expect(jobs.transitionJob(w.ctx(w.tom), j.id, { to: "en_route" })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await expect(jobs.updateJob(w.ctx(w.dispatcher), j.id, { title: "changed" })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await expect(jobs.assignJob(w.ctx(w.dispatcher), j.id, { member_ids: [] })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    w.store.jobs.update = original;
  });
});

describe("assignJob", () => {
  it("schedules a new job once it has a technician and a window, with a lead", async () => {
    const w = world();
    const j = await newJob(w);
    const a = await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
      member_ids: [w.tom.id, w.rina.id, w.tom.id],
      lead_member_id: w.rina.id,
      scheduled_start: iso(9),
      scheduled_end: iso(11),
    });
    expect(a.status).toBe("scheduled");
    expect(a.assignees.map((x) => [x.name, x.isLead])).toEqual([
      ["Tom Tech", false],
      ["Rina Tech", true],
    ]);
    const ev = w.data.events.find((e) => e.type === "assigned")!;
    expect(ev).toMatchObject({ fromStatus: "new", toStatus: "scheduled" });
    expect(ev.payload).toMatchObject({
      member_ids: [w.tom.id, w.rina.id],
      lead_member_id: w.rina.id,
      scheduled_start: iso(9),
    });
  });

  it("keeps a job new when only a technician is set, and sends it back when the window is cleared", async () => {
    const w = world();
    const j = await newJob(w);
    const a = await jobs.assignJob(w.ctx(w.dispatcher), j.id, { member_ids: [w.tom.id] });
    expect(a.status).toBe("new");
    expect(a.assignees[0]?.isLead).toBe(true);
    const s = await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(9),
      scheduled_end: iso(10),
    });
    expect(s.status).toBe("scheduled");
    const back = await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
      member_ids: [],
      scheduled_start: iso(9),
      scheduled_end: iso(10),
    });
    expect(back.status).toBe("new");
    const ev = w.data.events.filter((e) => e.type === "assigned").at(-1)!;
    expect(ev).toMatchObject({ fromStatus: "scheduled", toStatus: "new" });
  });

  it("reschedules an on-hold job", async () => {
    const w = world();
    let j = await scheduled(w);
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, {
      to: "on_hold",
      reason: "Parts",
      hold_reason: "parts",
    });
    j = await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(9, 12),
      scheduled_end: iso(10, 12),
    });
    expect(j).toMatchObject({ status: "scheduled", holdReason: null });
  });

  it("keeps in-progress jobs in progress when the window changes", async () => {
    const w = world();
    let j = await scheduled(w);
    j = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    j = await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(9),
      scheduled_end: iso(12),
    });
    expect(j.status).toBe("in_progress");
  });

  it("refuses overlapping visits unless a reason is given (SCH-03)", async () => {
    const w = world();
    const first = await scheduled(w);
    const second = await newJob(w);
    try {
      await jobs.assignJob(w.ctx(w.dispatcher), second.id, {
        member_ids: [w.tom.id],
        scheduled_start: iso(10),
        scheduled_end: iso(12),
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).details).toEqual({
        conflicts: [
          {
            kind: "overlap",
            member_id: w.tom.id,
            member_name: "Tom Tech",
            message: `Tom Tech has another visit at this time (${formatJobNumber(first.number)})`,
            job_numbers: [formatJobNumber(first.number)],
          },
        ],
      });
      expect((e as ConflictError).message).toBe(
        `Tom Tech has another visit at this time (${formatJobNumber(first.number)})`,
      );
    }
    const ok = await jobs.assignJob(w.ctx(w.dispatcher), second.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(10),
      scheduled_end: iso(12),
      override_reason: "Customer insists",
    });
    expect(ok.status).toBe("scheduled");
    expect(w.data.events.filter((e) => e.type === "assigned").at(-1)!.payload.override_reason).toBe(
      "Customer insists",
    );
    // Back-to-back visits don't overlap.
    const third = await newJob(w);
    await expect(
      jobs.assignJob(w.ctx(w.dispatcher), third.id, {
        member_ids: [w.rina.id],
        scheduled_start: iso(9),
        scheduled_end: iso(11),
      }),
    ).resolves.toMatchObject({ status: "scheduled" });
  });

  it("validates members, windows and job state", async () => {
    const w = world();
    const j = await newJob(w);
    await expect(
      jobs.assignJob(w.ctx(w.dispatcher), j.id, { member_ids: ["00000000-0000-4000-8000-0000000000fe"] }),
    ).rejects.toMatchObject({
      fields: [{ path: "member_ids" }],
    });
    await expect(
      jobs.assignJob(w.ctx(w.dispatcher), j.id, { member_ids: [w.tom.id], scheduled_start: iso(9) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      jobs.assignJob(w.ctx(w.dispatcher), j.id, {
        member_ids: [w.tom.id],
        scheduled_start: iso(9),
        scheduled_end: iso(9, 13),
      }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(jobs.assignJob(w.ctx(w.tom), j.id, { member_ids: [w.tom.id] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "canceled", reason: "dup" });
    await expect(
      jobs.assignJob(w.ctx(w.dispatcher), j.id, { member_ids: [w.tom.id] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("deleteJob and events", () => {
  it("soft-deletes (managers only) and lists events newest first", async () => {
    const w = world();
    const j = await scheduled(w);
    const events = await jobs.listJobEvents(w.ctx(w.tom), j.id);
    expect(events.map((e) => e.type)).toEqual(["assigned", "created"]);
    expect(events[1]!.actor?.name).toBe("Dan Dispatcher");
    await expect(jobs.deleteJob(w.ctx(w.dispatcher), j.id)).rejects.toBeInstanceOf(ForbiddenError);
    await jobs.deleteJob(w.ctx(w.owner), j.id);
    await expect(jobs.getJob(w.ctx(w.owner), j.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("notes", () => {
  it("lets the assigned technician and the office add notes", async () => {
    const w = world();
    const j = await scheduled(w);
    const n = await jobs.addNote(w.ctx(w.tom), j.id, { body: "Drain line clogged" });
    expect(n).toMatchObject({
      body: "Drain line clogged",
      visibility: "internal",
      author: { name: "Tom Tech" },
    });
    await jobs.addNote(w.ctx(w.dispatcher), j.id, { body: "Customer will be home", visibility: "customer" });
    expect((await jobs.listNotes(w.ctx(w.owner), j.id)).map((x) => x.visibility)).toEqual([
      "internal",
      "customer",
    ]);
    expect(w.data.events.filter((e) => e.type === "note_added")).toHaveLength(2);
    await expect(jobs.addNote(w.ctx(w.rina), j.id, { body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(jobs.addNote(w.ctx(w.tom), j.id, { body: "   " })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("attachments", () => {
  const photo = {
    file_name: "before photo (1).jpg",
    mime_type: "image/jpeg",
    size_bytes: 2_000_000,
    tag: "before",
    with_thumbnail: true,
  };

  it("presigns uploads into an org/job-scoped key and confirms them", async () => {
    const w = world();
    const files = fakeFiles();
    const j = await scheduled(w);
    const r = await jobs.requestAttachmentUpload(w.ctx(w.tom, { files }), j.id, photo);
    expect(r.attachment.storageKey).toMatch(
      new RegExp(`^org/org-1/jobs/${j.id}/[0-9a-f-]{36}/before-photo-1-.jpg$`),
    );
    expect(r.attachment.thumbKey).toMatch(/thumb\.webp$/);
    expect(r.attachment.status).toBe("pending");
    expect(r.thumbnailUploadUrl).toContain("thumb.webp");
    await expect(
      jobs.confirmAttachmentUpload(w.ctx(w.tom, { files }), r.attachment.id),
    ).rejects.toBeInstanceOf(ConflictError);
    files.existing.add(r.attachment.storageKey);
    const ready = await jobs.confirmAttachmentUpload(w.ctx(w.tom, { files }), r.attachment.id);
    expect(ready.status).toBe("ready");
    expect(await jobs.confirmAttachmentUpload(w.ctx(w.tom, { files }), r.attachment.id)).toMatchObject({
      status: "ready",
    });
    expect(w.data.events.filter((e) => e.type === "attachment_added")).toHaveLength(1);
    const list = await jobs.listAttachments(w.ctx(w.owner, { files }), j.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.url).toContain(r.attachment.storageKey);
    expect(list[0]!.thumbUrl).toContain("thumb.webp");
    expect((await jobs.listAttachments(w.ctx(w.owner), j.id))[0]!.url).toBeNull();
  });

  it("skips thumbnails for documents and enforces the normal limits", async () => {
    const w = world();
    const files = fakeFiles();
    const j = await scheduled(w);
    const pdf = await jobs.requestAttachmentUpload(w.ctx(w.tom, { files }), j.id, {
      file_name: "quote.pdf",
      mime_type: "application/pdf",
      size_bytes: 9_000_000,
      kind: "document",
      with_thumbnail: true,
    });
    expect(pdf.attachment.thumbKey).toBeNull();
    expect(pdf.thumbnailUploadUrl).toBeNull();
    await expect(
      jobs.requestAttachmentUpload(w.ctx(w.tom, { files }), j.id, { ...photo, size_bytes: 11 * 1024 * 1024 }),
    ).rejects.toMatchObject({ fields: [{ path: "size_bytes" }] });
    await expect(
      jobs.requestAttachmentUpload(w.ctx(w.tom, { files }), j.id, {
        ...photo,
        mime_type: "application/x-msdownload",
      }),
    ).rejects.toMatchObject({ fields: [{ path: "mime_type" }] });
  });

  it("applies the stricter demo limits (DEM-05)", async () => {
    const w = world();
    const files = fakeFiles();
    const j = await scheduled(w);
    const demo = w.ctx(w.tom, { files, demo: true });
    await expect(
      jobs.requestAttachmentUpload(demo, j.id, { ...photo, size_bytes: 6 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      jobs.requestAttachmentUpload(demo, j.id, { ...photo, mime_type: "application/pdf" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(jobs.requestAttachmentUpload(demo, j.id, photo)).resolves.toBeDefined();
  });

  it("needs file storage and an assigned technician", async () => {
    const w = world();
    const j = await scheduled(w);
    await expect(jobs.requestAttachmentUpload(w.ctx(w.tom), j.id, photo)).rejects.toThrow(/not configured/);
    await expect(jobs.confirmAttachmentUpload(w.ctx(w.tom), "x")).rejects.toThrow(/not configured/);
    await expect(
      jobs.requestAttachmentUpload(w.ctx(w.rina, { files: fakeFiles() }), j.id, photo),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      jobs.confirmAttachmentUpload(w.ctx(w.tom, { files: fakeFiles() }), "missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets uploaders and the office remove attachments", async () => {
    const w = world();
    const files = fakeFiles();
    const j = await scheduled(w, [w.tom.id, w.rina.id]);
    const r = await jobs.requestAttachmentUpload(w.ctx(w.tom, { files }), j.id, photo);
    await expect(jobs.removeAttachment(w.ctx(w.rina, { files }), r.attachment.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await jobs.removeAttachment(w.ctx(w.tom, { files }), r.attachment.id);
    expect(files.removed).toEqual([r.attachment.storageKey, r.attachment.thumbKey]);
    const r2 = await jobs.requestAttachmentUpload(w.ctx(w.tom, { files }), j.id, {
      ...photo,
      with_thumbnail: false,
    });
    await jobs.removeAttachment(w.ctx(w.dispatcher), r2.attachment.id);
    expect(w.data.attachments).toHaveLength(0);
    await expect(jobs.removeAttachment(w.ctx(w.dispatcher), "missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
