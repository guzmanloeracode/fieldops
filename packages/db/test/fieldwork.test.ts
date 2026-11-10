import {
  checklists,
  jobs,
  signatures,
  timeEntries,
  type Actor,
  type ServiceContext,
  type Store,
} from "@fieldops/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// 0.2 field work through the real repositories and row-level security: checklists (JOB-08), time entries
// (TEC-04) and signatures (JOB-10).

let t: TestDb;
let o: OrgData;
let other: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  o = await createOrgWithData(t.owner, "fw");
  other = await createOrgWithData(t.owner, "fw-other");
  await t.owner
    .update(s.serviceType)
    .set({
      checklistTemplate: [
        { label: "Unit cleaned", kind: "checkbox", unit: null, required: true },
        { label: "Supply air temperature", kind: "number", unit: "°F", required: true },
        { label: "Notes", kind: "text", unit: null, required: false },
      ],
    })
    .where(eq(s.serviceType.id, o.ids.serviceType));
});
afterAll(async () => t?.close());

function actor(org: OrgData, who: "owner" | "dispatcher" | "tech" | "tech2"): Actor {
  return {
    userId: org.users[who],
    memberId: org.members[who],
    organizationId: org.orgId,
    role: who.startsWith("tech") ? "technician" : (who as "owner" | "dispatcher"),
    name: who,
  };
}
const as = <T>(
  org: OrgData,
  who: "owner" | "dispatcher" | "tech" | "tech2",
  fn: (ctx: ServiceContext) => Promise<T>,
  now = new Date("2026-11-11T16:30:00Z"),
) => withStore(t.app, org.orgId, (store: Store) => fn({ actor: actor(org, who), store, now, demo: false }));

async function newAssignedJob(title: string) {
  const job = await as(o, "dispatcher", (ctx) =>
    jobs.createJob(ctx, {
      customer_id: o.ids.customer,
      site_id: o.ids.site,
      service_type_id: o.ids.serviceType,
      title,
    }),
  );
  await withStore(t.app, o.orgId, (store) =>
    store.jobs.setAssignments(job.id, [{ memberId: o.members.tech, isLead: true }]),
  );
  return job;
}

describe("checklist repository", () => {
  it("generates the template on create, records answers with the user's name, and blocks completion", async () => {
    const job = await newAssignedJob("Checklist job");
    const items = await as(o, "tech", (ctx) => checklists.getChecklist(ctx, job.id));
    expect(items.map((i) => [i.position, i.label, i.kind, i.unit, i.required])).toEqual([
      [0, "Unit cleaned", "checkbox", null, true],
      [1, "Supply air temperature", "number", "°F", true],
      [2, "Notes", "text", null, false],
    ]);

    const saved = await as(o, "tech", (ctx) =>
      checklists.updateChecklist(ctx, job.id, {
        items: [
          { id: items[0]!.id, value: true },
          { id: items[1]!.id, value: 55.5 },
        ],
      }),
    );
    expect(saved[0]).toMatchObject({ value: true, doneBy: { id: o.users.tech, name: "fw tech" } });
    expect(saved[1]).toMatchObject({ value: 55.5 });
    expect(saved[1]!.doneAt?.toISOString()).toBe("2026-11-11T16:30:00.000Z");
    expect(saved[2]).toMatchObject({ value: null, doneAt: null, doneBy: null });
    expect(await withStore(t.app, o.orgId, (st) => st.jobs.missingRequiredChecklistItems(job.id))).toEqual(
      [],
    );

    const cleared = await as(o, "dispatcher", (ctx) =>
      checklists.updateChecklist(ctx, job.id, { items: [{ id: items[0]!.id, value: false }] }),
    );
    expect(cleared[0]).toMatchObject({ value: null, doneAt: null });
    expect(await withStore(t.app, o.orgId, (st) => st.jobs.missingRequiredChecklistItems(job.id))).toEqual([
      "Unit cleaned",
    ]);
  });

  it("is invisible from another organization", async () => {
    const job = await newAssignedJob("Hidden checklist");
    const items = await withStore(t.app, o.orgId, (st) => st.checklist.list(job.id));
    expect(items.length).toBe(3);
    expect(await withStore(t.app, other.orgId, (st) => st.checklist.list(job.id))).toEqual([]);
    await withStore(t.app, other.orgId, (st) =>
      st.checklist.setValue(job.id, items[0]!.id, { value: true, doneByUserId: null, doneAt: new Date() }),
    );
    await withStore(t.app, other.orgId, (st) => st.checklist.replace(job.id, []));
    const after = await withStore(t.app, o.orgId, (st) => st.checklist.list(job.id));
    expect(after.map((i) => i.doneAt)).toEqual([null, null, null]);
  });
});

describe("time entry repository", () => {
  it("records travel and work from transitions and closes running clocks", async () => {
    const job = await newAssignedJob("Timed job");
    const at = (hhmm: string) => new Date(`2026-11-11T${hhmm}:00Z`);
    const move = (to: string, hhmm: string, extra: Record<string, unknown> = {}) =>
      as(o, "tech", (ctx) => jobs.transitionJob(ctx, job.id, { to, ...extra }), at(hhmm));
    await withStore(t.app, o.orgId, (st) =>
      st.jobs.update(job.id, {
        status: "scheduled",
        scheduledStart: at("15:00"),
        scheduledEnd: at("17:00"),
      }),
    );
    await move("en_route", "14:30");
    await move("in_progress", "15:00");
    await move("on_hold", "15:45", { reason: "Part", hold_reason: "parts" });

    const list = await as(o, "tech", (ctx) => timeEntries.listTimeEntries(ctx, job.id), at("16:00"));
    expect(
      list.entries.map((e) => [e.kind, e.member.name, e.startedAt.toISOString(), e.endedAt?.toISOString()]),
    ).toEqual([
      ["travel", "fw tech", at("14:30").toISOString(), at("15:00").toISOString()],
      ["work", "fw tech", at("15:00").toISOString(), at("15:45").toISOString()],
    ]);
    expect(list.totals).toEqual([
      { member: { id: o.members.tech, name: "fw tech" }, travelMin: 30, workMin: 45, running: null },
    ]);

    const edited = await as(
      o,
      "tech",
      (ctx) =>
        timeEntries.updateTimeEntry(ctx, list.entries[1]!.id, {
          started_at: at("14:55").toISOString(),
          ended_at: at("15:45").toISOString(),
          reason: "Started before tapping Start",
        }),
      at("16:00"),
    );
    expect(edited).toMatchObject({ editedReason: "Started before tapping Start", editedBy: o.users.tech });
    const manual = await as(
      o,
      "dispatcher",
      (ctx) =>
        timeEntries.addTimeEntry(ctx, job.id, {
          member_id: o.members.tech2,
          kind: "work",
          started_at: at("15:00").toISOString(),
          ended_at: at("15:30").toISOString(),
          reason: "Helper on site",
        }),
      at("16:00"),
    );
    expect(manual).toMatchObject({ source: "manual", member: { id: o.members.tech2, name: "fw tech2" } });

    // Another organization can't read or change these entries.
    expect(await withStore(t.app, other.orgId, (st) => st.timeEntries.listByJob(job.id))).toEqual([]);
    expect(await withStore(t.app, other.orgId, (st) => st.timeEntries.get(manual.id))).toBeNull();
    expect(
      await withStore(t.app, other.orgId, (st) => st.timeEntries.update(manual.id, { editedReason: "x" })),
    ).toBeNull();
    expect(await withStore(t.app, other.orgId, (st) => st.timeEntries.closeOpen(job.id, new Date()))).toBe(0);
  });

  it("closes only one member's running entries when asked", async () => {
    const job = await newAssignedJob("Two clocks");
    await withStore(t.app, o.orgId, async (st) => {
      await st.timeEntries.create({
        jobId: job.id,
        memberId: o.members.tech,
        kind: "work",
        startedAt: new Date("2026-11-11T10:00:00Z"),
        endedAt: null,
        source: "status",
      });
      await st.timeEntries.create({
        jobId: job.id,
        memberId: o.members.tech2,
        kind: "work",
        startedAt: new Date("2026-11-11T10:00:00Z"),
        endedAt: null,
        source: "status",
      });
      expect(await st.timeEntries.closeOpen(job.id, new Date("2026-11-11T11:00:00Z"), o.members.tech)).toBe(
        1,
      );
      const entries = await st.timeEntries.listByJob(job.id);
      expect(entries.map((e) => [e.member.id, e.endedAt?.toISOString() ?? null])).toEqual([
        [o.members.tech, "2026-11-11T11:00:00.000Z"],
        [o.members.tech2, null],
      ]);
    });
  });
});

describe("signature requirement", () => {
  it("blocks completion until a signature is captured", async () => {
    await t.owner
      .update(s.organization)
      .set({ settings: { require_signature: true } })
      .where(eq(s.organization.id, o.orgId));
    const job = await newAssignedJob("Signed job");
    await withStore(t.app, o.orgId, (st) => st.jobs.update(job.id, { status: "in_progress" }));
    const items = await as(o, "tech", (ctx) => checklists.getChecklist(ctx, job.id));
    await as(o, "tech", (ctx) =>
      checklists.updateChecklist(ctx, job.id, {
        items: [
          { id: items[0]!.id, value: true },
          { id: items[1]!.id, value: 54 },
        ],
      }),
    );
    await expect(
      as(o, "tech", (ctx) => jobs.transitionJob(ctx, job.id, { to: "completed" })),
    ).rejects.toMatchObject({ details: { missing: ["signature"] } });

    const attachment = await withStore(t.app, o.orgId, (st) =>
      st.attachments.create({
        jobId: job.id,
        kind: "signature",
        storageKey: `org/${o.orgId}/sig.png`,
        thumbKey: null,
        fileName: "signature.png",
        mimeType: "image/png",
        sizeBytes: 100,
        tag: null,
        caption: "Cara Customer",
        status: "ready",
        uploadedBy: o.users.tech,
      }),
    );
    const signed = await as(o, "tech", (ctx) =>
      signatures.captureSignature(ctx, job.id, {
        attachment_id: attachment.id,
        signer_name: "Cara Customer",
      }),
    );
    expect(signed.caption).toBe("Cara Customer");
    const done = await as(o, "tech", (ctx) => jobs.transitionJob(ctx, job.id, { to: "completed" }));
    expect(done.status).toBe("completed");
    await t.owner.update(s.organization).set({ settings: {} }).where(eq(s.organization.id, o.orgId));
  });
});
