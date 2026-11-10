import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { iso, world } from "../test/fixtures";
import type { MemoryExpenseRepo } from "../test/memory-expenses";
import { fakeFiles, uuid } from "../test/memory-store";
import * as expenses from "./expenses";
import * as jobs from "./jobs";
import * as org from "./organization";

type World = ReturnType<typeof world>;

let day = 0;

/** A job scheduled for Tom on its own day (the auto-approve threshold is $50.00, the dispatcher limit $250.00). */
async function tomsJob(w: World) {
  day += 1;
  const j = await jobs.createJob(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    title: "AC leaking",
  });
  return jobs.assignJob(w.ctx(w.dispatcher), j.id, {
    member_ids: [w.tom.id],
    scheduled_start: iso(9, day),
    scheduled_end: iso(11, day),
  });
}

const part = (extra: Record<string, unknown> = {}) => ({
  item: "Drain pump",
  quantity: 1,
  unit_cost_minor: 4500,
  supplier: "Ferguson HVAC",
  reason: "Pump seized",
  ...extra,
});

function receipt(w: World, jobId: string, status: "ready" | "pending" = "ready") {
  const id = uuid();
  w.data.attachments.push({
    id,
    jobId,
    kind: "photo",
    storageKey: `org/x/jobs/${jobId}/${id}/receipt.jpg`,
    thumbKey: null,
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1000,
    tag: null,
    caption: "Receipt",
    status,
    uploadedBy: w.tom.userId,
    createdAt: new Date(),
  });
  return id;
}

const rows = (w: World) => (w.store.expenses as MemoryExpenseRepo).rows;

describe("expenseTotal, canDecideExpense, summarizeExpenses", () => {
  it("multiplies quantity by unit cost and rounds to a whole minor unit", () => {
    expect(expenses.expenseTotal(2.5, 1999, "USD")).toBe(4998);
    expect(expenses.expenseTotal(1.15, 100, "USD")).toBe(115);
    expect(expenses.expenseTotal(3, 150_000_00, "IDR")).toBe(450_000_00);
  });

  it("lets dispatchers decide only below their limit", () => {
    const settings = {
      approval: { autoApproveBelowMinor: 5000, dispatcherLimitMinor: 25000 },
      requireSignature: false,
    };
    expect(expenses.canDecideExpense({ role: "dispatcher" }, { totalMinor: 24999 }, settings)).toBe(true);
    expect(expenses.canDecideExpense({ role: "dispatcher" }, { totalMinor: 25000 }, settings)).toBe(false);
    expect(expenses.canDecideExpense({ role: "admin" }, { totalMinor: 9_999_999 }, settings)).toBe(true);
    expect(expenses.canDecideExpense({ role: "technician" }, { totalMinor: 1 }, settings)).toBe(false);
  });

  it("sums approved and pending requests", () => {
    expect(
      expenses.summarizeExpenses([
        { status: "approved", totalMinor: 100 },
        { status: "pending", totalMinor: 40 },
        { status: "pending", totalMinor: 60 },
        { status: "rejected", totalMinor: 999 },
      ]),
    ).toEqual({ approvedMinor: 100, pendingMinor: 100, pendingCount: 2 });
  });
});

describe("requestExpense (EXP-01)", () => {
  it("auto-approves requests under the threshold and records the event", async () => {
    const w = world();
    const job = await tomsJob(w);
    const e = await expenses.requestExpense(w.ctx(w.tom), job.id, part());
    expect(e).toMatchObject({
      status: "approved",
      autoApproved: true,
      totalMinor: 4500,
      currency: "USD",
      requester: { id: w.tom.id, name: "Tom Tech" },
      decidedBy: null,
      job: { id: job.id, number: job.number, title: "AC leaking" },
      supplier: "Ferguson HVAC",
    });
    expect(e.decidedAt?.toISOString()).toBe("2026-11-10T09:00:00.000Z");
    const event = w.data.events.find((x) => x.type === "expense_requested");
    expect(event?.payload).toMatchObject({ expense_id: e.id, total_minor: 4500, auto_approved: true });
  });

  it("leaves larger requests pending and rounds the total", async () => {
    const w = world();
    const job = await tomsJob(w);
    const e = await expenses.requestExpense(
      w.ctx(w.tom),
      job.id,
      part({
        kind: "expense",
        item: "Refrigerant R-410A",
        quantity: 2.5,
        unit_cost_minor: 2399,
        supplier: "",
      }),
    );
    expect(e).toMatchObject({ status: "pending", autoApproved: false, totalMinor: 5998, supplier: null });
    // Exactly the threshold isn't "below" it.
    const big = await expenses.requestExpense(w.ctx(w.dispatcher), job.id, part({ unit_cost_minor: 5000 }));
    expect(big).toMatchObject({ status: "pending", decidedAt: null });
  });

  it("only accepts a ready receipt uploaded to the same job", async () => {
    const w = world();
    const job = await tomsJob(w);
    const other = await tomsJob(w);
    const good = receipt(w, job.id);
    const e = await expenses.requestExpense(w.ctx(w.tom), job.id, part({ receipt_attachment_id: good }));
    expect(e.receiptAttachmentId).toBe(good);
    for (const bad of [receipt(w, other.id), receipt(w, job.id, "pending"), uuid()]) {
      await expect(
        expenses.requestExpense(w.ctx(w.tom), job.id, part({ receipt_attachment_id: bad })),
      ).rejects.toMatchObject({ fields: [{ path: "receipt_attachment_id" }] });
    }
  });

  it("links receipts with signed URLs when storage is configured", async () => {
    const w = world();
    const job = await tomsJob(w);
    const id = receipt(w, job.id);
    const withReceipt = await expenses.requestExpense(
      w.ctx(w.tom),
      job.id,
      part({ receipt_attachment_id: id }),
    );
    const without = await expenses.requestExpense(w.ctx(w.tom), job.id, part());
    w.data.attachments.find((a) => a.id === id)!.thumbKey = "thumb.webp";
    const links = await expenses.receiptLinks(w.ctx(w.owner, { files: fakeFiles() }), [withReceipt, without]);
    expect(links).toEqual({
      [withReceipt.id]: {
        url: expect.stringContaining("receipt.jpg"),
        thumbUrl: "https://files.example/get/thumb.webp",
      },
    });
    w.data.attachments.find((a) => a.id === id)!.thumbKey = null;
    expect(
      (await expenses.receiptLinks(w.ctx(w.owner, { files: fakeFiles() }), [withReceipt]))[withReceipt.id],
    ).toMatchObject({ thumbUrl: null });
    w.data.attachments.find((a) => a.id === id)!.status = "pending";
    expect(await expenses.receiptLinks(w.ctx(w.owner, { files: fakeFiles() }), [withReceipt])).toEqual({});
    expect(await expenses.receiptLinks(w.ctx(w.owner), [withReceipt])).toEqual({});
  });

  it("is limited to open jobs the requester may work on", async () => {
    const w = world();
    const job = await tomsJob(w);
    await expect(expenses.requestExpense(w.ctx(w.rina), job.id, part())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      expenses.requestExpense(w.ctx(w.tom), job.id, part({ quantity: 1.234 })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(expenses.requestExpense(w.ctx(w.tom), job.id, part({ reason: "" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await jobs.transitionJob(w.ctx(w.dispatcher), job.id, { to: "canceled", reason: "Customer moved" });
    await expect(expenses.requestExpense(w.ctx(w.dispatcher), job.id, part())).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("listing", () => {
  it("shows technicians only requests on their own jobs", async () => {
    const w = world();
    const toms = await tomsJob(w);
    const rinas = await jobs.assignJob(
      w.ctx(w.dispatcher),
      (
        await jobs.createJob(w.ctx(w.dispatcher), {
          customer_id: w.customerId,
          site_id: w.siteId,
          title: "Noise",
        })
      ).id,
      { member_ids: [w.rina.id], scheduled_start: iso(13), scheduled_end: iso(14) },
    );
    const a = await expenses.requestExpense(w.ctx(w.tom), toms.id, part());
    const b = await expenses.requestExpense(w.ctx(w.rina), rinas.id, part({ unit_cost_minor: 9000 }));

    const tomList = await expenses.listExpenses(w.ctx(w.tom), { limit: 50, page: 1 });
    expect(tomList.rows.map((r) => r.id)).toEqual([a.id]);
    const all = await expenses.listExpenses(w.ctx(w.owner), { limit: 50 });
    expect(all.rows.map((r) => r.id)).toEqual([b.id, a.id]);
    const pending = await expenses.listExpenses(w.ctx(w.dispatcher), { limit: 50, status: ["pending"] });
    expect(pending.rows.map((r) => r.id)).toEqual([b.id]);

    expect((await expenses.listJobExpenses(w.ctx(w.tom), toms.id)).map((r) => r.id)).toEqual([a.id]);
    await expect(expenses.listJobExpenses(w.ctx(w.tom), rinas.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(expenses.getExpense(w.ctx(w.tom), b.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(expenses.getExpense(w.ctx(w.owner), uuid())).rejects.toBeInstanceOf(NotFoundError);
    await expect(expenses.getExpense(w.ctx(w.owner), "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    expect((await expenses.getExpense(w.ctx(w.rina), b.id)).item).toBe("Drain pump");
  });

  it("counts pending requests for approvers only", async () => {
    const w = world();
    const job = await tomsJob(w);
    await expenses.requestExpense(w.ctx(w.tom), job.id, part({ unit_cost_minor: 12000 }));
    await expenses.requestExpense(w.ctx(w.tom), job.id, part());
    expect(await expenses.countPendingExpenses(w.ctx(w.dispatcher))).toBe(1);
    expect(await expenses.countPendingExpenses(w.ctx(w.tom))).toBe(0);
  });
});

describe("decideExpense (EXP-02)", () => {
  async function pending(w: World, unit: number) {
    const job = await tomsJob(w);
    return expenses.requestExpense(w.ctx(w.tom), job.id, part({ unit_cost_minor: unit }));
  }

  it("lets owners and admins decide any amount, with an event", async () => {
    const w = world();
    const e = await pending(w, 90_000);
    const decided = await expenses.decideExpense(w.ctx(w.admin), e.id, {
      decision: "approve",
      comment: "Go ahead",
    });
    expect(decided).toMatchObject({
      status: "approved",
      decidedBy: { id: w.admin.id, name: "Adam Admin" },
      decisionComment: "Go ahead",
    });
    const event = w.data.events.find((x) => x.type === "expense_decided");
    expect(event?.payload).toMatchObject({ expense_id: e.id, decision: "approved", comment: "Go ahead" });
    const r = await pending(w, 7000);
    expect(
      await expenses.decideExpense(w.ctx(w.owner), r.id, { decision: "reject", comment: "Use stock" }),
    ).toMatchObject({ status: "rejected", decisionComment: "Use stock" });
    expect(w.data.events.filter((x) => x.type === "expense_decided").at(-1)?.payload).toMatchObject({
      decision: "rejected",
      comment: "Use stock",
    });
  });

  it("limits dispatchers to amounts below their limit", async () => {
    const w = world();
    const small = await pending(w, 24_999);
    const large = await pending(w, 25_000);
    expect(
      (await expenses.decideExpense(w.ctx(w.dispatcher), small.id, { decision: "approve" })).status,
    ).toBe("approved");
    await expect(
      expenses.decideExpense(w.ctx(w.dispatcher), large.id, { decision: "approve" }),
    ).rejects.toThrow("above your approval limit");
    await expect(expenses.decideExpense(w.ctx(w.tom), large.id, { decision: "approve" })).rejects.toThrow(
      "don't have permission",
    );
  });

  it("needs a comment to reject and only decides pending requests once", async () => {
    const w = world();
    const e = await pending(w, 30_000);
    await expect(expenses.decideExpense(w.ctx(w.owner), e.id, { decision: "reject" })).rejects.toMatchObject({
      fields: [{ path: "comment" }],
    });
    await expenses.decideExpense(w.ctx(w.owner), e.id, { decision: "approve" });
    await expect(
      expenses.decideExpense(w.ctx(w.owner), e.id, { decision: "approve" }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Decided by someone else between the read and the write.
    const raced = await pending(w, 30_000);
    const repo = w.store.expenses;
    const original = repo.decide.bind(repo);
    repo.decide = async () => null;
    await expect(
      expenses.decideExpense(w.ctx(w.owner), raced.id, { decision: "approve" }),
    ).rejects.toBeInstanceOf(ConflictError);
    repo.decide = original;
  });
});

describe("decideExpenses (EXP-03 bulk)", () => {
  it("checks every request on its own and reports each result", async () => {
    const w = world();
    const job = await tomsJob(w);
    const req = (unit: number) =>
      expenses.requestExpense(w.ctx(w.tom), job.id, part({ unit_cost_minor: unit }));
    const a = await req(10_000);
    const b = await req(20_000);
    const over = await req(40_000);
    const auto = await req(1_000);
    const missing = uuid();
    const results = await expenses.decideExpenses(w.ctx(w.dispatcher), {
      ids: [a.id, b.id, over.id, auto.id, missing, a.id],
      decision: "approve",
    });
    expect(results).toEqual([
      { id: a.id, ok: true, status: "approved" },
      { id: b.id, ok: true, status: "approved" },
      {
        id: over.id,
        ok: false,
        error: { code: "forbidden", message: "This amount is above your approval limit" },
      },
      {
        id: auto.id,
        ok: false,
        error: { code: "conflict", message: "This request has already been decided" },
      },
      { id: missing, ok: false, error: { code: "not_found", message: "Expense not found" } },
    ]);
    const rejected = await expenses.decideExpenses(w.ctx(w.owner), {
      ids: [over.id],
      decision: "reject",
      comment: "Too expensive",
    });
    expect(rejected).toEqual([{ id: over.id, ok: true, status: "rejected" }]);
  });

  it("refuses technicians and rethrows unexpected errors", async () => {
    const w = world();
    const job = await tomsJob(w);
    const e = await expenses.requestExpense(w.ctx(w.tom), job.id, part({ unit_cost_minor: 10_000 }));
    await expect(
      expenses.decideExpenses(w.ctx(w.tom), { ids: [e.id], decision: "approve" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      expenses.decideExpenses(w.ctx(w.owner), { ids: [e.id], decision: "reject" }),
    ).rejects.toBeInstanceOf(ValidationError);
    w.store.expenses.get = async () => {
      throw new Error("database down");
    };
    await expect(
      expenses.decideExpenses(w.ctx(w.owner), { ids: [e.id], decision: "approve" }),
    ).rejects.toThrow("database down");
  });
});

describe("markExpenseUsed (TEC-03)", () => {
  it("records an approved part as used once", async () => {
    const w = world();
    const job = await tomsJob(w);
    const e = await expenses.requestExpense(w.ctx(w.tom), job.id, part());
    const used = await expenses.markExpenseUsed(w.ctx(w.tom), e.id);
    expect(used.usedAt?.toISOString()).toBe("2026-11-10T09:00:00.000Z");
    const again = await expenses.markExpenseUsed(w.ctx(w.dispatcher), e.id);
    expect(again.usedAt).toEqual(used.usedAt);
    expect(w.data.events.filter((x) => x.type === "part_used")).toHaveLength(1);
    expect(rows(w)).toHaveLength(1);
  });

  it("rejects pending requests, expenses and other technicians", async () => {
    const w = world();
    const job = await tomsJob(w);
    const pendingPart = await expenses.requestExpense(w.ctx(w.tom), job.id, part({ unit_cost_minor: 9000 }));
    const parking = await expenses.requestExpense(
      w.ctx(w.tom),
      job.id,
      part({ kind: "expense", item: "Parking", unit_cost_minor: 800 }),
    );
    await expect(expenses.markExpenseUsed(w.ctx(w.tom), pendingPart.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(expenses.markExpenseUsed(w.ctx(w.tom), parking.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(expenses.markExpenseUsed(w.ctx(w.rina), parking.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("operations settings", () => {
  it("lets owners and admins read and change thresholds and the signature rule", async () => {
    const w = world();
    expect(await org.getOperationsSettings(w.ctx(w.admin))).toEqual({
      currency: "USD",
      approval: { autoApproveBelowMinor: 5000, dispatcherLimitMinor: 25000 },
      requireSignature: false,
    });
    const updated = await org.updateOperationsSettings(w.ctx(w.owner), {
      auto_approve_below_minor: 7500,
      dispatcher_limit_minor: 50000,
      require_signature: true,
    });
    expect(updated).toEqual({
      currency: "USD",
      approval: { autoApproveBelowMinor: 7500, dispatcherLimitMinor: 50000 },
      requireSignature: true,
    });
    // The new threshold applies to the next request.
    const job = await tomsJob(w);
    expect(
      (await expenses.requestExpense(w.ctx(w.tom), job.id, part({ unit_cost_minor: 7000 }))).status,
    ).toBe("approved");
  });

  it("rejects dispatchers and a dispatcher limit below the auto-approve threshold", async () => {
    const w = world();
    await expect(org.getOperationsSettings(w.ctx(w.dispatcher))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      org.updateOperationsSettings(w.ctx(w.owner), {
        auto_approve_below_minor: 10000,
        dispatcher_limit_minor: 5000,
        require_signature: false,
      }),
    ).rejects.toMatchObject({ fields: [{ path: "dispatcher_limit_minor" }] });
  });
});
