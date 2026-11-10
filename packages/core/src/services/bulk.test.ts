import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../domain/errors";
import { iso, world } from "../test/fixtures";
import * as bulk from "./bulk";
import * as jobs from "./jobs";

async function setup() {
  const w = world();
  const make = (title: string) =>
    jobs.createJob(w.ctx(w.dispatcher), { customer_id: w.customerId, site_id: w.siteId, title });
  const a = await make("A");
  const b = await make("B");
  const c = await make("C");
  const ctx = w.ctx(w.dispatcher);
  const runItem: bulk.ItemRunner = (fn) => fn(ctx);
  return { w, a, b, c, runItem };
}

describe("bulk job actions (JOB-04)", () => {
  it("assigns a technician as lead, keeps helpers and the visit window, and reports per job", async () => {
    const { w, a, b, c, runItem } = await setup();
    await jobs.assignJob(w.ctx(w.dispatcher), a.id, {
      member_ids: [w.rina.id, w.dispatcher.id],
      lead_member_id: w.rina.id,
      scheduled_start: iso(9),
      scheduled_end: iso(11),
    });
    await jobs.assignJob(w.ctx(w.dispatcher), c.id, { member_ids: [w.tom.id] });
    // Tom is busy 09:00–11:00 with another job: assigning him to A overlaps.
    const busy = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Busy",
    });
    await jobs.assignJob(w.ctx(w.dispatcher), busy.id, {
      member_ids: [w.tom.id],
      scheduled_start: iso(10),
      scheduled_end: iso(12),
    });

    const res = await bulk.runBulkJobAction(
      w.dispatcher,
      {
        action: "assign",
        ids: [a.id, b.id, c.id, b.id, "00000000-0000-4000-8000-ffffffffffff"],
        member_id: w.tom.id,
      },
      runItem,
    );
    expect(res).toMatchObject({ action: "assign", updated: 1, skipped: 3 });
    expect(res.results.map((r) => [r.number, r.ok, r.message])).toEqual([
      ["JOB-000001", false, "This visit overlaps another job for the same technician"],
      ["JOB-000002", true, undefined],
      ["JOB-000003", false, "Already assigned"],
      [null, false, "Job not found"],
    ]);
    const updatedB = await jobs.getJob(w.ctx(w.dispatcher), b.id);
    expect(updatedB.assignees.map((x) => [x.name, x.isLead])).toEqual([["Tom Tech", true]]);

    // Without a conflict the helpers and the window stay.
    await jobs.assignJob(w.ctx(w.dispatcher), busy.id, { member_ids: [] });
    const again = await bulk.runBulkJobAction(
      w.dispatcher,
      { action: "assign", ids: [a.id], member_id: w.tom.id },
      runItem,
    );
    expect(again.updated).toBe(1);
    const updatedA = await jobs.getJob(w.ctx(w.dispatcher), a.id);
    expect(updatedA.assignees.map((x) => [x.name, x.isLead]).sort()).toEqual([
      ["Dan Dispatcher", false],
      ["Tom Tech", true],
    ]);
    expect(updatedA.scheduledStart?.toISOString()).toBe(iso(9));
  });

  it("changes status through the status machine", async () => {
    const { w, a, b, runItem } = await setup();
    await jobs.transitionJob(w.ctx(w.dispatcher), b.id, { to: "canceled", reason: "Duplicate" });
    const res = await bulk.runBulkJobAction(
      w.dispatcher,
      { action: "transition", ids: [a.id, b.id], to: "canceled", reason: "Customer moved" },
      runItem,
    );
    expect(res.results.map((r) => [r.ok, r.message])).toEqual([
      [true, undefined],
      [false, "Already canceled"],
    ]);
    const noReason = await bulk.runBulkJobAction(
      w.dispatcher,
      { action: "transition", ids: [a.id], to: "scheduled" },
      runItem,
    );
    expect(noReason.results[0]).toMatchObject({ ok: false, number: "JOB-000001" });
  });

  it("checks the role and the input, and rethrows unexpected errors", async () => {
    const { w, a, runItem } = await setup();
    await expect(
      bulk.runBulkJobAction(w.tom, { action: "assign", ids: [a.id], member_id: w.tom.id }, runItem),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      bulk.runBulkJobAction(w.tom, { action: "transition", ids: [a.id], to: "canceled" }, runItem),
    ).rejects.toThrow(ForbiddenError);
    await expect(bulk.runBulkJobAction(w.dispatcher, { action: "assign", ids: [] }, runItem)).rejects.toThrow(
      ValidationError,
    );
    const boom: bulk.ItemRunner = () => Promise.reject(new Error("db down"));
    await expect(
      bulk.runBulkJobAction(w.dispatcher, { action: "assign", ids: [a.id], member_id: w.tom.id }, boom),
    ).rejects.toThrow("db down");
  });
});
