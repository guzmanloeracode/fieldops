import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { formatJobNumber } from "../domain/numbering";
import { iso, world } from "../test/fixtures";
import { member, uuid } from "../test/memory-store";
import { conflictSummary, detectConflicts } from "./conflicts";
import * as jobs from "./jobs";
import * as schedule from "./schedule";

// 0.2 dispatch: conflicts (SCH-03), the board and agenda (SCH-01, TEC-01) and availability (SCH-04).
// The world's organization works Mon–Fri 08:00–17:00 in Chicago; 11 Nov 2026 is a Wednesday and
// iso(14) is 08:00 there.

const WEEKDAYS = [1, 2, 3, 4, 5].map((day) => ({ day, open: "08:00", close: "17:00" }));

function dispatchWorld() {
  const w = world();
  w.data.org.timezone = "America/Chicago";
  w.data.org.businessHours = WEEKDAYS;
  w.tom.skills = ["ac"];
  w.rina.skills = ["ac", "refrigerant"];
  w.data.serviceTypes[0]!.requiredSkills = ["refrigerant"];
  return w;
}

async function newJob(w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) {
  return jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC leaking",
    ...extra,
  });
}

async function assign(
  w: ReturnType<typeof world>,
  jobId: string,
  memberIds: string[],
  start: string | null,
  end: string | null,
  override?: string,
) {
  return jobs.assignJob(w.ctx(w.dispatcher), jobId, {
    member_ids: memberIds,
    scheduled_start: start,
    scheduled_end: end,
    ...(override ? { override_reason: override } : {}),
  });
}

describe("detectConflicts (SCH-03)", () => {
  it("reports every kind for each member, in member order", async () => {
    const w = dispatchWorld();
    const busy = await newJob(w);
    await assign(w, busy.id, [w.tom.id], iso(15), iso(17));
    w.data.timeOff = [
      {
        id: uuid(),
        memberId: w.tom.id,
        startsAt: new Date(iso(0)),
        endsAt: new Date(iso(0, 12)),
        reason: "Dentist",
        createdAt: new Date(),
      },
    ];
    const job = await newJob(w, { service_type_id: w.serviceTypeId });
    // 15:00–00:00 Chicago runs past closing time.
    const conflicts = await detectConflicts(
      w.ctx(w.dispatcher),
      job,
      [w.rina.id, w.tom.id],
      new Date(iso(16)),
      new Date(iso(6, 12)),
    );
    expect(conflicts.map((c) => [c.member_name, c.kind])).toEqual([
      ["Rina Tech", "outside_hours"],
      ["Tom Tech", "overlap"],
      ["Tom Tech", "outside_hours"],
      ["Tom Tech", "time_off"],
      ["Tom Tech", "missing_skills"],
    ]);
    expect(conflicts[1]).toMatchObject({ job_numbers: [formatJobNumber(busy.number)] });
    expect(conflicts[2]!.message).toBe("Tom Tech works 08:00–17:00 on Wednesdays");
    expect(conflicts[3]!.message).toBe("Tom Tech is off at this time (Dentist)");
    expect(conflicts[4]).toMatchObject({
      missing_skills: ["refrigerant"],
      message: "Tom Tech doesn't have the required skills: refrigerant",
    });
    expect(conflictSummary(conflicts)).toBe("This assignment has 5 scheduling conflicts");
  });

  it("explains days off and time off without a reason", async () => {
    const w = dispatchWorld();
    w.data.timeOff = [
      {
        id: uuid(),
        memberId: w.rina.id,
        startsAt: new Date(iso(0, 14)),
        endsAt: new Date(iso(0, 15)),
        reason: null,
        createdAt: new Date(),
      },
    ];
    const job = await newJob(w);
    // Saturday 14 Nov.
    const conflicts = await detectConflicts(
      w.ctx(w.dispatcher),
      job,
      [w.rina.id],
      new Date(iso(15, 14)),
      new Date(iso(16, 14)),
    );
    expect(conflicts.map((c) => c.message)).toEqual([
      "Rina Tech doesn't work on Saturdays",
      "Rina Tech is off at this time",
    ]);
  });

  it("checks only skills without a window, and nothing without members", async () => {
    const w = dispatchWorld();
    const job = await newJob(w, { service_type_id: w.serviceTypeId });
    const ctx = w.ctx(w.dispatcher);
    expect((await detectConflicts(ctx, job, [w.tom.id], null, null)).map((c) => c.kind)).toEqual([
      "missing_skills",
    ]);
    expect(await detectConflicts(ctx, job, [], null, null)).toEqual([]);
    expect(await detectConflicts(ctx, job, [uuid()], new Date(iso(15)), new Date(iso(16)))).toEqual([]);
    // A member's own hours win over the business hours.
    w.tom.workingHours = [{ day: 3, open: "06:00", close: "09:00" }];
    expect(await detectConflicts(ctx, job, [w.tom.id], new Date(iso(13)), new Date(iso(14)))).toEqual([
      expect.objectContaining({ kind: "missing_skills" }),
    ]);
  });
});

describe("assignJob with conflicts", () => {
  it("needs a reason and records what was overridden", async () => {
    const w = dispatchWorld();
    const job = await newJob(w, { service_type_id: w.serviceTypeId });
    const err = await assign(w, job.id, [w.tom.id], iso(15), iso(16)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe("Tom Tech doesn't have the required skills: refrigerant");
    const saved = await assign(w, job.id, [w.tom.id], iso(15), iso(16), "Rina is training him");
    expect(saved.status).toBe("scheduled");
    expect(w.data.events.at(-1)!.payload).toMatchObject({
      override_reason: "Rina is training him",
      overridden: [{ kind: "missing_skills", member_id: w.tom.id }],
    });
    // Without conflicts a reason isn't recorded.
    const other = await newJob(w);
    await assign(w, other.id, [w.rina.id], iso(15), iso(16), "not needed");
    expect(w.data.events.at(-1)!.payload.override_reason).toBeUndefined();
  });

  it("previews conflicts without saving", async () => {
    const w = dispatchWorld();
    const job = await newJob(w, { service_type_id: w.serviceTypeId });
    const preview = await jobs.previewConflicts(w.ctx(w.dispatcher), job.id, {
      member_ids: [w.tom.id, w.tom.id],
      scheduled_start: iso(15),
      scheduled_end: iso(16),
    });
    expect(preview.map((c) => c.kind)).toEqual(["missing_skills"]);
    expect((await jobs.getJob(w.ctx(w.dispatcher), job.id)).assignees).toEqual([]);
    const none = await jobs.previewConflicts(w.ctx(w.dispatcher), job.id, { member_ids: [w.rina.id] });
    expect(none).toEqual([]);
    await expect(jobs.previewConflicts(w.ctx(w.tom), job.id, { member_ids: [w.tom.id] })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("getBoard (SCH-01)", () => {
  it("returns lanes, visits in the range and the unscheduled queue", async () => {
    const w = dispatchWorld();
    const visit = await newJob(w);
    await assign(w, visit.id, [w.tom.id, w.dispatcher.id], iso(15), iso(16), "Dan rides along");
    const nextWeek = await newJob(w);
    await assign(w, nextWeek.id, [w.rina.id], iso(15, 18), iso(16, 18));
    const low = await newJob(w, { priority: "low", title: "Low" });
    const urgent = await newJob(w, { priority: "urgent", title: "Urgent" });
    w.data.timeOff = [
      {
        id: uuid(),
        memberId: w.rina.id,
        startsAt: new Date(iso(0, 11)),
        endsAt: new Date(iso(0, 12)),
        reason: "Training",
        createdAt: new Date(),
      },
    ];
    w.rina.workingHours = [{ day: 3, open: "07:00", close: "15:00" }];

    const board = await schedule.getBoard(w.ctx(w.dispatcher), { from: "2026-11-11", to: "2026-11-11" });
    expect(board.timeZone).toBe("America/Chicago");
    expect(board.rangeStart.toISOString()).toBe("2026-11-11T06:00:00.000Z");
    expect(board.rangeEnd.toISOString()).toBe("2026-11-12T06:00:00.000Z");
    expect(board.jobs.map((j) => j.id)).toEqual([visit.id]);
    expect(board.lanes.map((l) => l.member.name)).toEqual(["Rina Tech", "Tom Tech", "Dan Dispatcher"]);
    expect(board.lanes[0]).toMatchObject({
      customHours: true,
      workingHours: [{ day: 3, open: "07:00", close: "15:00" }],
      timeOff: [expect.objectContaining({ reason: "Training" })],
    });
    expect(board.lanes[1]).toMatchObject({ customHours: false, workingHours: WEEKDAYS });
    expect(board.unscheduled.map((j) => j.id)).toEqual([urgent.id, low.id]);

    const tomOnly = await schedule.getBoard(
      w.ctx(w.dispatcher),
      { from: "2026-11-11", to: "2026-11-18", member: w.tom.id },
      { unscheduledLimit: 1 },
    );
    expect(tomOnly.lanes.map((l) => l.member.name)).toEqual(["Tom Tech"]);
    expect(tomOnly.jobs.map((j) => j.id)).toEqual([visit.id]);
    expect(tomOnly.unscheduled).toHaveLength(1);
    const noQueue = await schedule.getBoard(
      w.ctx(w.dispatcher),
      { from: "2026-11-11", to: "2026-11-11" },
      { unscheduledLimit: 0 },
    );
    expect(noQueue.unscheduled).toEqual([]);
  });

  it("rejects technicians, unknown members and bad ranges", async () => {
    const w = dispatchWorld();
    await expect(schedule.getBoard(w.ctx(w.tom), { from: "2026-11-11", to: "2026-11-11" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      schedule.getBoard(w.ctx(w.dispatcher), { from: "2026-11-11", to: "2026-11-11", member: uuid() }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      schedule.getBoard(w.ctx(w.dispatcher), { from: "2026-11-11", to: "2026-12-31" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      schedule.getBoard(w.ctx(w.dispatcher), { from: "2026-11-11", to: "2026-11-10" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("getAgenda (GET /me/agenda)", () => {
  it("lists the caller's visits from today through a week ahead", async () => {
    const w = dispatchWorld();
    const today = await newJob(w);
    await assign(w, today.id, [w.tom.id], iso(15, 10), iso(16, 10));
    const later = await newJob(w);
    await assign(w, later.id, [w.tom.id], iso(15, 17), iso(16, 17));
    const tooLate = await newJob(w);
    await assign(w, tooLate.id, [w.tom.id], iso(15, 19), iso(16, 19));
    const rinas = await newJob(w);
    await assign(w, rinas.id, [w.rina.id], iso(15, 10), iso(16, 10));
    const agenda = await schedule.getAgenda(w.ctx(w.tom));
    expect(agenda).toMatchObject({ from: "2026-11-10", to: "2026-11-17", timeZone: "America/Chicago" });
    expect(agenda.jobs.map((j) => j.id)).toEqual([today.id, later.id]);
  });
});

describe("availability (SCH-04)", () => {
  it("lists the team with hours, skills and recent time off", async () => {
    const w = dispatchWorld();
    const old = new Date("2026-10-01T00:00:00Z");
    const soon = new Date("2026-11-20T00:00:00Z");
    const later = new Date("2031-06-01T00:00:00Z");
    w.data.timeOff = [
      { id: uuid(), memberId: w.tom.id, startsAt: old, endsAt: old, reason: "Old", createdAt: old },
      {
        id: uuid(),
        memberId: w.tom.id,
        startsAt: soon,
        endsAt: new Date("2026-11-21T00:00:00Z"),
        reason: "Soon",
        createdAt: old,
      },
      { id: uuid(), memberId: w.tom.id, startsAt: later, endsAt: later, reason: "Later", createdAt: old },
    ];
    const team = await schedule.getTeamAvailability(w.ctx(w.dispatcher));
    expect(team.members.map((m) => m.name)).toEqual([
      "Rina Tech",
      "Tom Tech",
      "Dan Dispatcher",
      "Adam Admin",
      "Olivia Owner",
    ]);
    expect(team.members[1]).toMatchObject({
      skills: ["ac"],
      timeOff: [expect.objectContaining({ reason: "Soon" }), expect.objectContaining({ reason: "Later" })],
    });
    await expect(schedule.getTeamAvailability(w.ctx(w.tom))).rejects.toThrow(ForbiddenError);
  });

  it("updates hours and skills", async () => {
    const w = dispatchWorld();
    const ctx = w.ctx(w.dispatcher);
    const updated = await schedule.updateMemberAvailability(ctx, w.tom.id, {
      working_hours: [
        { day: 5, open: "08:00", close: "12:00" },
        { day: 1, open: "08:00", close: "17:00" },
      ],
      skills: ["refrigerant", "AC", "ac"],
    });
    expect(updated.workingHours).toEqual([
      { day: 1, open: "08:00", close: "17:00" },
      { day: 5, open: "08:00", close: "12:00" },
    ]);
    expect(updated.skills).toEqual(["ac", "refrigerant"]);
    expect(
      (await schedule.updateMemberAvailability(ctx, w.tom.id, { working_hours: null })).workingHours,
    ).toBeNull();
    expect((await schedule.updateMemberAvailability(ctx, w.tom.id, {})).skills).toEqual([
      "ac",
      "refrigerant",
    ]);
    await expect(schedule.updateMemberAvailability(ctx, uuid(), { skills: [] })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      schedule.updateMemberAvailability(ctx, w.tom.id, {
        working_hours: [{ day: 9, open: "8", close: "9" }],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(schedule.updateMemberAvailability(w.ctx(w.tom), w.tom.id, {})).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("reports a member that disappears during the update", async () => {
    const w = dispatchWorld();
    const ghost = member("technician", "Ghost");
    w.data.members.push(ghost);
    const original = w.store.availability.updateMember;
    w.store.availability.updateMember = async () => false;
    await expect(
      schedule.updateMemberAvailability(w.ctx(w.dispatcher), ghost.id, { skills: [] }),
    ).rejects.toThrow(NotFoundError);
    w.store.availability.updateMember = original;
  });

  it("adds and removes time off", async () => {
    const w = dispatchWorld();
    const ctx = w.ctx(w.dispatcher);
    const t = await schedule.createTimeOff(ctx, {
      member_id: w.tom.id,
      starts_at: "2026-11-20T08:00:00-06:00",
      ends_at: "2026-11-20T17:00:00-06:00",
      reason: "Vacation",
    });
    expect(t).toMatchObject({ memberId: w.tom.id, reason: "Vacation" });
    expect(t.startsAt.toISOString()).toBe("2026-11-20T14:00:00.000Z");
    const noReason = await schedule.createTimeOff(ctx, {
      member_id: w.tom.id,
      starts_at: "2026-11-21T08:00:00Z",
      ends_at: "2026-11-21T09:00:00Z",
    });
    expect(noReason.reason).toBeNull();
    // Offsets that would sort wrong as strings are compared as instants.
    await expect(
      schedule.createTimeOff(ctx, {
        member_id: w.tom.id,
        starts_at: "2026-11-20T08:00:00-06:00",
        ends_at: "2026-11-20T09:00:00+05:00",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      schedule.createTimeOff(ctx, {
        member_id: uuid(),
        starts_at: "2026-11-20T08:00:00Z",
        ends_at: "2026-11-20T09:00:00Z",
      }),
    ).rejects.toThrow(NotFoundError);
    await schedule.deleteTimeOff(ctx, t.id);
    await expect(schedule.deleteTimeOff(ctx, t.id)).rejects.toThrow(NotFoundError);
    expect(await w.store.availability.getTimeOff(noReason.id)).toMatchObject({ id: noReason.id });
    expect(await w.store.availability.getTimeOff(t.id)).toBeNull();
    await expect(schedule.deleteTimeOff(w.ctx(w.tom), noReason.id)).rejects.toThrow(ForbiddenError);
  });
});
