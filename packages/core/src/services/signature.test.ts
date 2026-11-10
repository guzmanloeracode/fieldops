import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { InvalidTransitionError } from "../domain/job-status";
import { iso, world } from "../test/fixtures";
import { fakeFiles, uuid } from "../test/memory-store";
import * as jobs from "./jobs";
import * as signatures from "./signature";

async function inProgress(w: ReturnType<typeof world>) {
  const j = await jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC repair",
  });
  await jobs.assignJob(w.ctx(w.dispatcher), j.id, {
    member_ids: [w.tom.id],
    scheduled_start: iso(9),
    scheduled_end: iso(11),
  });
  return jobs.transitionJob(w.ctx(w.tom), j.id, { to: "in_progress" });
}

function upload(w: ReturnType<typeof world>, jobId: string, extra: Record<string, unknown> = {}) {
  const id = uuid();
  w.data.attachments.push({
    id,
    jobId,
    kind: "signature",
    storageKey: `org/x/jobs/${jobId}/${id}/signature.png`,
    thumbKey: null,
    fileName: "signature.png",
    mimeType: "image/png",
    sizeBytes: 900,
    tag: null,
    caption: "Cara Customer",
    status: "pending",
    uploadedBy: w.tom.userId,
    createdAt: new Date(),
    ...extra,
  });
  return id;
}

describe("customer signature (JOB-10)", () => {
  it("is required to complete when the organization asks for it", async () => {
    const w = world();
    w.data.org.settings.requireSignature = true;
    const j = await inProgress(w);
    const err = await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidTransitionError);
    expect(err).toMatchObject({
      message: "Capture the customer's signature first",
      details: { missing: ["signature"] },
    });

    const files = fakeFiles();
    const id = upload(w, j.id);
    files.existing.add(w.data.attachments.find((a) => a.id === id)!.storageKey);
    const signed = await signatures.captureSignature(w.ctx(w.tom, { files }), j.id, {
      attachment_id: id,
      signer_name: "Cara Customer",
    });
    expect(signed).toMatchObject({ id, status: "ready", caption: "Cara Customer" });
    expect(w.data.events.find((e) => e.type === "signature_captured")?.payload).toEqual({
      attachment_id: id,
      signer_name: "Cara Customer",
    });
    expect((await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" })).status).toBe("completed");
  });

  it("is optional otherwise", async () => {
    const w = world();
    const j = await inProgress(w);
    expect((await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" })).status).toBe("completed");
  });

  it("accepts an already confirmed upload and falls back to the signer's name", async () => {
    const w = world();
    const j = await inProgress(w);
    const id = upload(w, j.id, { status: "ready", caption: null });
    const signed = await signatures.captureSignature(w.ctx(w.dispatcher), j.id, {
      attachment_id: id,
      signer_name: "Cara",
    });
    expect(signed.caption).toBe("Cara");
    expect(await signatures.hasSignature(w.ctx(w.dispatcher), j.id)).toBe(true);
  });

  it("rejects uploads that aren't this job's finished signature", async () => {
    const w = world();
    const j = await inProgress(w);
    const capture = (attachment_id: string, extra = {}) =>
      signatures
        .captureSignature(w.ctx(w.tom, extra), j.id, { attachment_id, signer_name: "Cara" })
        .catch((e: unknown) => e);
    expect(await capture(uuid())).toBeInstanceOf(NotFoundError);
    expect(await capture(upload(w, uuid()))).toBeInstanceOf(NotFoundError);
    expect(await capture(upload(w, j.id, { kind: "photo" }))).toBeInstanceOf(ValidationError);
    expect(await capture(upload(w, j.id, { mimeType: "application/pdf" }))).toBeInstanceOf(ValidationError);
    expect(await capture(upload(w, j.id))).toBeInstanceOf(ConflictError);
    expect(await capture(upload(w, j.id), { files: fakeFiles() })).toBeInstanceOf(ConflictError);
    await expect(
      signatures.captureSignature(w.ctx(w.tom), j.id, { attachment_id: uuid(), signer_name: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("can't sign a closed job or someone else's job", async () => {
    const w = world();
    const j = await inProgress(w);
    const id = upload(w, j.id, { status: "ready" });
    await expect(
      signatures.captureSignature(w.ctx(w.rina), j.id, { attachment_id: id, signer_name: "Cara" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await jobs.transitionJob(w.ctx(w.tom), j.id, { to: "completed" });
    await expect(
      signatures.captureSignature(w.ctx(w.tom), j.id, { attachment_id: id, signer_name: "Cara" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("latestSignature picks the newest ready signature", () => {
    const base = {
      jobId: "j",
      storageKey: "k",
      thumbKey: null,
      fileName: "s.png",
      mimeType: "image/png",
      sizeBytes: 1,
      tag: null,
      caption: null,
      uploadedBy: null,
    };
    const old = {
      ...base,
      id: "a",
      kind: "signature" as const,
      status: "ready" as const,
      createdAt: new Date(1),
    };
    const newer = { ...old, id: "b", createdAt: new Date(2) };
    const pending = { ...old, id: "c", status: "pending" as const, createdAt: new Date(3) };
    const photo = { ...old, id: "d", kind: "photo" as const, createdAt: new Date(4) };
    expect(signatures.latestSignature([old, newer, pending, photo])?.id).toBe("b");
    expect(signatures.latestSignature([photo])).toBeNull();
  });
});
