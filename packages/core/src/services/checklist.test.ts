import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { InvalidTransitionError } from "../domain/job-status";
import { iso, world } from "../test/fixtures";
import { uuid } from "../test/memory-store";
import * as checklist from "./checklist";
import * as jobs from "./jobs";

const TEMPLATE = [
  { label: "Unit cleaned", kind: "checkbox" as const, unit: null, required: true },
  { label: "Supply air temperature", kind: "number" as const, unit: "°F", required: true },
  { label: "Findings", kind: "text" as const, unit: null, required: false },
  { label: "Photo after cleaning", kind: "photo" as const, unit: null, required: true },
];

function withTemplate() {
  const w = world();
  w.data.serviceTypes[0]!.checklistTemplate = TEMPLATE;
  const other = uuid();
  w.data.serviceTypes.push({
    ...w.data.serviceTypes[0]!,
    id: other,
    name: "Duct cleaning",
    checklistTemplate: [{ label: "Ducts vacuumed", kind: "checkbox", unit: null, required: true }],
  });
  return { ...w, otherServiceTypeId: other };
}

async function assignedJob(
  w: ReturnType<typeof withTemplate>,
  serviceTypeId: string | null = w.serviceTypeId,
) {
  const j = await jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC tune-up",
    ...(serviceTypeId ? { service_type_id: serviceTypeId } : {}),
  });
  return jobs.assignJob(w.ctx(w.dispatcher), j.id, {
    member_ids: [w.tom.id],
    scheduled_start: iso(9),
    scheduled_end: iso(11),
  });
}

function readyPhoto(w: ReturnType<typeof withTemplate>, jobId: string, extra: Record<string, unknown> = {}) {
  const id = uuid();
  w.data.attachments.push({
    id,
    jobId,
    kind: "photo",
    storageKey: `k/${id}`,
    thumbKey: null,
    fileName: "after.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 10,
    tag: "after",
    caption: null,
    status: "ready",
    uploadedBy: w.tom.userId,
    createdAt: new Date(),
    ...extra,
  });
  return id;
}

describe("itemsFromTemplate and progress", () => {
  it("keeps template order and maps units", () => {
    expect(checklist.itemsFromTemplate(TEMPLATE)).toEqual([
      { position: 0, label: "Unit cleaned", kind: "checkbox", unit: null, required: true },
      { position: 1, label: "Supply air temperature", kind: "number", unit: "°F", required: true },
      { position: 2, label: "Findings", kind: "text", unit: null, required: false },
      { position: 3, label: "Photo after cleaning", kind: "photo", unit: null, required: true },
    ]);
    expect(checklist.itemsFromTemplate([{ label: "x", kind: "text", required: false }])[0]!.unit).toBeNull();
  });

  it("counts done and required items left", () => {
    expect(
      checklist.progress([
        { required: true, doneAt: new Date() },
        { required: true, doneAt: null },
        { required: false, doneAt: null },
      ]),
    ).toEqual({ total: 3, done: 1, requiredLeft: 1 });
  });
});

describe("checklist generation (JOB-08)", () => {
  it("creates items from the service type when the job is created", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    const items = await checklist.getChecklist(w.ctx(w.tom), j.id);
    expect(items.map((i) => [i.label, i.kind, i.required, i.value, i.doneAt])).toEqual([
      ["Unit cleaned", "checkbox", true, null, null],
      ["Supply air temperature", "number", true, null, null],
      ["Findings", "text", false, null, null],
      ["Photo after cleaning", "photo", true, null, null],
    ]);
  });

  it("creates nothing for a job without a service type", async () => {
    const w = withTemplate();
    const j = await assignedJob(w, null);
    expect(await checklist.getChecklist(w.ctx(w.dispatcher), j.id)).toEqual([]);
    expect(await checklist.generateForJob(w.ctx(w.dispatcher), j.id, uuid())).toBe(0);
  });

  it("follows a service type change until an item is done", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    await jobs.updateJob(w.ctx(w.dispatcher), j.id, { service_type_id: w.otherServiceTypeId });
    expect((await checklist.getChecklist(w.ctx(w.dispatcher), j.id)).map((i) => i.label)).toEqual([
      "Ducts vacuumed",
    ]);
    const [item] = await checklist.getChecklist(w.ctx(w.tom), j.id);
    await checklist.updateChecklist(w.ctx(w.tom), j.id, { items: [{ id: item!.id, value: true }] });
    const job = await jobs.updateJob(w.ctx(w.dispatcher), j.id, { service_type_id: w.serviceTypeId });
    expect(job.serviceTypeId).toBe(w.serviceTypeId);
    // Work had started, so the answers stay.
    expect((await checklist.getChecklist(w.ctx(w.dispatcher), j.id)).map((i) => i.label)).toEqual([
      "Ducts vacuumed",
    ]);
  });

  it("clears an untouched checklist when the service type is removed", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    await jobs.updateJob(w.ctx(w.dispatcher), j.id, { service_type_id: null });
    expect(await checklist.getChecklist(w.ctx(w.dispatcher), j.id)).toEqual([]);
  });
});

describe("updateChecklist", () => {
  it("records answers per kind with who and when, in one timeline event", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    const items = await checklist.getChecklist(w.ctx(w.tom), j.id);
    const photo = readyPhoto(w, j.id);
    const now = new Date("2026-11-11T10:30:00Z");
    const out = await checklist.updateChecklist(w.ctx(w.tom, { now }), j.id, {
      items: [
        { id: items[0]!.id, value: true },
        { id: items[1]!.id, value: 54.5 },
        { id: items[2]!.id, value: "  Coil was dirty  " },
        { id: items[3]!.id, value: photo },
      ],
    });
    expect(out.map((i) => i.value)).toEqual([true, 54.5, "Coil was dirty", photo]);
    expect(out.every((i) => i.doneAt?.getTime() === now.getTime())).toBe(true);
    expect(out[0]!.doneBy).toEqual({ id: w.tom.userId, name: "Tom Tech" });
    const events = w.data.events.filter((e) => e.type === "checklist_updated");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      items: ["Unit cleaned", "Supply air temperature", "Findings", "Photo after cleaning"],
      done: 4,
      cleared: 0,
    });

    // All required items done: the job can be completed.
    await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    expect((await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" })).status).toBe("completed");
  });

  it("clears items and ignores unchanged answers", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    const items = await checklist.getChecklist(w.ctx(w.tom), j.id);
    await checklist.updateChecklist(w.ctx(w.tom), j.id, {
      items: [
        { id: items[0]!.id, value: true },
        { id: items[2]!.id, value: "ok" },
      ],
    });
    const out = await checklist.updateChecklist(w.ctx(w.dispatcher), j.id, {
      items: [
        { id: items[0]!.id, value: false },
        { id: items[1]!.id, value: null },
        { id: items[2]!.id, value: "ok" },
        { id: items[3]!.id, value: null },
      ],
    });
    expect(out[0]).toMatchObject({ value: null, doneAt: null, doneBy: null });
    expect(out[2]).toMatchObject({ value: "ok" });
    const events = w.data.events.filter((e) => e.type === "checklist_updated");
    expect(events.map((e) => e.payload)).toEqual([
      { items: ["Unit cleaned", "Findings"], done: 2, cleared: 0 },
      { items: ["Unit cleaned"], done: 0, cleared: 1 },
    ]);
    // Nothing changed: no event.
    await checklist.updateChecklist(w.ctx(w.tom), j.id, {
      items: [
        { id: items[2]!.id, value: "ok" },
        { id: items[2]!.id, value: " " },
      ],
    });
    expect(w.data.events.filter((e) => e.type === "checklist_updated")).toHaveLength(3);
  });

  it("lists the missing required items when completion is attempted early", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    const items = await checklist.getChecklist(w.ctx(w.tom), j.id);
    await checklist.updateChecklist(w.ctx(w.tom), j.id, { items: [{ id: items[0]!.id, value: true }] });
    await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
    const err = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidTransitionError);
    expect(err).toMatchObject({ details: { missing: ["Supply air temperature", "Photo after cleaning"] } });
  });

  it("validates values against the item kind", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    const [box, num, text, photo] = await checklist.getChecklist(w.ctx(w.tom), j.id);
    const bad = async (id: string, value: unknown) =>
      checklist.updateChecklist(w.ctx(w.tom), j.id, { items: [{ id, value }] }).catch((e: unknown) => e);
    expect(await bad(box!.id, "yes")).toBeInstanceOf(ValidationError);
    expect(await bad(num!.id, "12")).toMatchObject({
      details: { fields: [{ path: "items.0.value", message: "“Supply air temperature” needs a number" }] },
    });
    expect(await bad(text!.id, 5)).toBeInstanceOf(ValidationError);
    expect(await bad(photo!.id, true)).toBeInstanceOf(ValidationError);
    expect(await bad(photo!.id, "not-a-uuid")).toBeInstanceOf(ValidationError);
    // A photo of another job, a document, or an unfinished upload doesn't count.
    const other = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Another visit",
    });
    expect(await bad(photo!.id, readyPhoto(w, other.id))).toBeInstanceOf(ValidationError);
    expect(await bad(photo!.id, readyPhoto(w, j.id, { kind: "document" }))).toBeInstanceOf(ValidationError);
    expect(await bad(photo!.id, readyPhoto(w, j.id, { status: "pending" }))).toBeInstanceOf(ValidationError);
    expect(await bad(photo!.id, uuid())).toBeInstanceOf(ValidationError);
    expect(await bad(uuid(), true)).toMatchObject({
      details: { fields: [{ path: "items.0.id", message: "Not an item of this job" }] },
    });
  });

  it("is limited to the assigned technician and open jobs", async () => {
    const w = withTemplate();
    const j = await assignedJob(w);
    const [box] = await checklist.getChecklist(w.ctx(w.tom), j.id);
    await expect(
      checklist.updateChecklist(w.ctx(w.rina), j.id, { items: [{ id: box!.id, value: true }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(checklist.getChecklist(w.ctx(w.rina), j.id)).rejects.toBeInstanceOf(NotFoundError);
    await jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "new" });
    await jobs.transitionJob(w.ctx(w.dispatcher), j.id, { to: "canceled", reason: "Customer canceled" });
    await expect(
      checklist.updateChecklist(w.ctx(w.dispatcher), j.id, { items: [{ id: box!.id, value: true }] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
