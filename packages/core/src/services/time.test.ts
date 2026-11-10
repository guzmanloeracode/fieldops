import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { iso, world } from "../test/fixtures";
import { uuid } from "../test/memory-store";
import * as jobs from "./jobs";
import * as time from "./time";

const at = (hhmm: string) => new Date(`2026-11-11T${hhmm}:00Z`);

async function scheduled(w: ReturnType<typeof world>, memberIds = [w.tom.id], lead?: string) {
  const j = await jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC repair",
  });
  return jobs.assignJob(w.ctx(w.dispatcher), j.id, {
    member_ids: memberIds,
    lead_member_id: lead ?? memberIds[0],
    scheduled_start: iso(9),
    scheduled_end: iso(11),
  });
}

describe("time recorded from status changes (TEC-04)", () => {
  it("runs travel and work clocks through the lifecycle", async () => {
    const w = world();
    const j = await scheduled(w);
    const move = (to: string, hhmm: string, extra: Record<string, unknown> = {}) =>
      jobs.transitionJob(w.ctx(w.tom, { now: at(hhmm) }), j.id, { to, ...extra });
    await move("en_route", "08:30");
    await move("in_progress", "09:00");
    await move("on_hold", "10:00", { reason: "Waiting for a part", hold_reason: "parts" });
    await move("in_progress", "10:30");
    await move("completed", "11:15");

    const { entries, totals } = await time.listTimeEntries(w.ctx(w.tom, { now: at("12:00") }), j.id);
    expect(entries.map((e) => [e.kind, e.startedAt.toISOString(), e.endedAt?.toISOString()])).toEqual([
      ["travel", at("08:30").toISOString(), at("09:00").toISOString()],
      ["work", at("09:00").toISOString(), at("10:00").toISOString()],
      ["work", at("10:30").toISOString(), at("11:15").toISOString()],
    ]);
    expect(entries.every((e) => e.source === "status" && e.member.id === w.tom.id)).toBe(true);
    expect(totals).toEqual([
      { member: { id: w.tom.id, name: "Tom Tech" }, travelMin: 30, workMin: 105, running: null },
    ]);
  });

  it("charges office moves to the lead and stops everyone's clock on hold", async () => {
    const w = world();
    const j = await scheduled(w, [w.tom.id, w.rina.id], w.rina.id);
    await jobs.transitionJob(w.ctx(w.tom, { now: at("09:00") }), j.id, { to: "in_progress" });
    // The office resumes on behalf of the crew: the lead's clock runs.
    await jobs.transitionJob(w.ctx(w.dispatcher, { now: at("09:30") }), j.id, {
      to: "on_hold",
      reason: "Customer stepped out",
      hold_reason: "customer",
    });
    await jobs.transitionJob(w.ctx(w.dispatcher, { now: at("10:00") }), j.id, { to: "in_progress" });
    const { entries, totals } = await time.listTimeEntries(w.ctx(w.dispatcher, { now: at("10:20") }), j.id);
    expect(entries.map((e) => [e.member.name, e.kind, e.endedAt?.toISOString() ?? null])).toEqual([
      ["Tom Tech", "work", at("09:30").toISOString()],
      ["Rina Tech", "work", null],
    ]);
    expect(totals.find((t) => t.member.id === w.rina.id)).toMatchObject({ workMin: 20, running: "work" });
  });

  it("stops the clock when a job is unscheduled or canceled, and ignores jobs without technicians", async () => {
    const w = world();
    const j = await scheduled(w);
    await jobs.transitionJob(w.ctx(w.tom, { now: at("08:00") }), j.id, { to: "en_route" });
    await jobs.transitionJob(w.ctx(w.dispatcher, { now: at("08:20") }), j.id, { to: "in_progress" });
    await jobs.transitionJob(w.ctx(w.dispatcher, { now: at("08:40") }), j.id, {
      to: "on_hold",
      reason: "Parts",
      hold_reason: "parts",
    });
    expect(w.data.timeEntries.every((e) => e.endedAt)).toBe(true);

    const unassigned = { id: uuid(), assignees: [] };
    expect(await time.recordTransition(w.ctx(w.dispatcher), unassigned, "start")).toBeNull();
    expect(await time.recordTransition(w.ctx(w.dispatcher), unassigned, "reopen")).toBeNull();
    expect(await time.recordTransition(w.ctx(w.dispatcher), unassigned, "cancel")).toBeNull();
    expect(time.clockMember(w.ctx(w.dispatcher), { assignees: [] })).toBeNull();
    expect(
      time.clockMember(w.ctx(w.dispatcher), {
        assignees: [{ memberId: w.rina.id, userId: w.rina.userId, name: "Rina", isLead: false }],
      }),
    ).toBe(w.rina.id);
  });
});

describe("editing time", () => {
  async function worked(w: ReturnType<typeof world>) {
    const j = await scheduled(w, [w.tom.id, w.rina.id]);
    await jobs.transitionJob(w.ctx(w.tom, { now: at("09:00") }), j.id, { to: "in_progress" });
    await jobs.transitionJob(w.ctx(w.rina, { now: at("09:10") }), j.id, {
      to: "on_hold",
      reason: "x",
      hold_reason: "parts",
    });
    await jobs.transitionJob(w.ctx(w.rina, { now: at("09:20") }), j.id, { to: "in_progress" });
    const { entries } = await time.listTimeEntries(w.ctx(w.tom, { now: at("10:00") }), j.id);
    return { j, tomEntry: entries[0]!, rinaEntry: entries[1]! };
  }

  it("lets a technician correct their own entry with a reason, recorded in the timeline", async () => {
    const w = world();
    const { j, tomEntry } = await worked(w);
    const updated = await time.updateTimeEntry(w.ctx(w.tom, { now: at("10:00") }), tomEntry.id, {
      started_at: at("08:45").toISOString(),
      ended_at: at("09:10").toISOString(),
      reason: "Started before tapping Start",
    });
    expect(updated).toMatchObject({ startedAt: at("08:45"), editedReason: "Started before tapping Start" });
    expect(updated.editedBy).toBe(w.tom.userId);
    const event = w.data.events.find((e) => e.type === "time_edited")!;
    expect(event.jobId).toBe(j.id);
    expect(event.payload).toMatchObject({
      action: "edited",
      member_name: "Tom Tech",
      kind: "work",
      before: { started_at: at("09:00").toISOString(), ended_at: at("09:10").toISOString() },
      after: { started_at: at("08:45").toISOString(), ended_at: at("09:10").toISOString() },
      reason: "Started before tapping Start",
    });
  });

  it("keeps a running entry running and lets the office edit anyone's time", async () => {
    const w = world();
    const { rinaEntry } = await worked(w);
    const updated = await time.updateTimeEntry(w.ctx(w.dispatcher, { now: at("10:00") }), rinaEntry.id, {
      started_at: at("09:15").toISOString(),
      ended_at: null,
      reason: "Rina arrived earlier",
    });
    expect(updated.endedAt).toBeNull();
  });

  it("rejects edits by other technicians, future times and reopening a finished entry", async () => {
    const w = world();
    const { tomEntry, rinaEntry } = await worked(w);
    const input = {
      started_at: at("09:00").toISOString(),
      ended_at: at("09:05").toISOString(),
      reason: "Fix",
    };
    await expect(time.updateTimeEntry(w.ctx(w.rina), tomEntry.id, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(time.updateTimeEntry(w.ctx(w.owner), uuid(), input)).rejects.toBeInstanceOf(NotFoundError);
    const now = { now: at("09:30") };
    await expect(
      time.updateTimeEntry(w.ctx(w.tom, now), tomEntry.id, { ...input, ended_at: at("11:00").toISOString() }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      time.updateTimeEntry(w.ctx(w.tom, now), tomEntry.id, {
        ...input,
        started_at: at("10:00").toISOString(),
        ended_at: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      time.updateTimeEntry(w.ctx(w.tom, now), tomEntry.id, { ...input, ended_at: null }),
    ).rejects.toMatchObject({ details: { fields: [{ path: "ended_at", message: "Enter when it ended" }] } });
    await expect(
      time.updateTimeEntry(w.ctx(w.tom, now), tomEntry.id, { ...input, reason: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(rinaEntry.endedAt).toBeNull();
  });

  it("adds manual entries for yourself, or for anyone from the office", async () => {
    const w = world();
    const { j } = await worked(w);
    const input = {
      kind: "travel",
      started_at: at("07:30").toISOString(),
      ended_at: at("08:00").toISOString(),
      reason: "Drive to the supplier for a part",
    };
    const mine = await time.addTimeEntry(w.ctx(w.tom, { now: at("10:00") }), j.id, input);
    expect(mine).toMatchObject({ source: "manual", kind: "travel", member: { id: w.tom.id } });
    const forRina = await time.addTimeEntry(w.ctx(w.dispatcher, { now: at("10:00") }), j.id, {
      ...input,
      member_id: w.rina.id,
    });
    expect(forRina.member.id).toBe(w.rina.id);
    expect(w.data.events.filter((e) => e.type === "time_edited").map((e) => e.payload.action)).toEqual([
      "added",
      "added",
    ]);
    await expect(
      time.addTimeEntry(w.ctx(w.tom, { now: at("10:00") }), j.id, { ...input, member_id: w.rina.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      time.addTimeEntry(w.ctx(w.dispatcher, { now: at("10:00") }), j.id, { ...input, member_id: uuid() }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(time.addTimeEntry(w.ctx(w.tom, { now: at("07:45") }), j.id, input)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("entryMinutes and totals", () => {
  it("counts running entries up to now and never goes negative", () => {
    const now = at("10:00");
    expect(time.entryMinutes({ startedAt: at("09:00"), endedAt: null }, now)).toBe(60);
    expect(time.entryMinutes({ startedAt: at("11:00"), endedAt: null }, now)).toBe(0);
    expect(time.totals([], now)).toEqual([]);
  });
});
