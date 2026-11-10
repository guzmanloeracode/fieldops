import { expenses as expenseService, type Actor, type ServiceContext } from "@fieldops/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Parts and expenses repository (EXP-01–03) against PostgreSQL with row-level security.

let t: TestDb;
let a: OrgData;
let b: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "e");
  b = await createOrgWithData(t.owner, "f");
});
afterAll(async () => t?.close());

const base = {
  kind: "part" as const,
  item: "Capacitor 45/5 µF",
  quantity: 2,
  unitCostMinor: 1850,
  totalMinor: 3700,
  currency: "USD" as const,
  supplier: "Johnstone Supply",
  reason: "Weak capacitor",
  receiptAttachmentId: null,
  status: "pending" as const,
  autoApproved: false,
  decidedByMemberId: null,
  decidedAt: null,
  decisionComment: null,
};

describe("expense repository", () => {
  it("creates, lists with names and filters, decides once and records use", async () => {
    await withStore(t.app, a.orgId, async (store) => {
      const seeded = await store.expenses.listByJob(a.ids.job);
      expect(seeded).toHaveLength(1);
      expect(seeded[0]).toMatchObject({
        item: "Drain pump",
        quantity: 1,
        requester: { id: a.members.tech, name: "e tech" },
        job: { id: a.ids.job, status: "scheduled" },
        decidedBy: null,
      });

      const created = await store.expenses.create({
        ...base,
        jobId: a.ids.job,
        requesterMemberId: a.members.tech2,
        quantity: 1.25,
        receiptAttachmentId: a.ids.attachment,
      });
      expect(created).toMatchObject({ quantity: 1.25, billable: true, markupBps: 0, usedAt: null });

      const parking = await store.expenses.create({
        ...base,
        jobId: a.ids.job,
        requesterMemberId: a.members.tech,
        kind: "expense",
        item: "Parking",
        unitCostMinor: 1200,
        totalMinor: 1200,
        quantity: 1,
        status: "approved",
        autoApproved: true,
        decidedAt: new Date(),
      });

      expect(await store.expenses.countPending()).toBe(2);
      const all = await store.expenses.list({ limit: 50, page: 1 });
      expect(all.total).toBe(3);
      expect(all.rows[0]!.id).toBe(parking.id);
      expect((await store.expenses.list({ limit: 50, status: ["approved"] })).rows.map((r) => r.id)).toEqual([
        parking.id,
      ]);
      expect((await store.expenses.list({ limit: 50, kind: "expense" })).rows).toHaveLength(1);
      expect(
        (await store.expenses.list({ limit: 50, technician: a.members.tech2 })).rows.map((r) => r.id),
      ).toEqual([created.id]);
      expect((await store.expenses.list({ limit: 50, job: a.ids.job })).rows).toHaveLength(3);
      expect((await store.expenses.list({ limit: 50, assignedMemberId: a.members.tech })).rows).toHaveLength(
        3,
      );
      expect((await store.expenses.list({ limit: 50, assignedMemberId: a.members.tech2 })).rows).toHaveLength(
        0,
      );
      expect(
        (await store.expenses.list({ limit: 50, from: "2000-01-01", to: "2999-12-31" })).rows,
      ).toHaveLength(3);
      expect((await store.expenses.list({ limit: 50, to: "2001-01-01" })).rows).toHaveLength(0);

      // Keyset pages walk every row exactly once.
      const first = await store.expenses.list({ limit: 2 });
      expect(first.rows).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await store.expenses.list({ limit: 2, cursor: first.nextCursor! });
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(3);

      const decided = await store.expenses.decide(created.id, {
        status: "approved",
        decidedByMemberId: a.members.owner,
        decidedAt: new Date(),
        comment: "OK",
      });
      expect(decided).toMatchObject({ status: "approved", decisionComment: "OK" });
      expect(
        await store.expenses.decide(created.id, {
          status: "rejected",
          decidedByMemberId: a.members.owner,
          decidedAt: new Date(),
          comment: "late",
        }),
      ).toBeNull();
      expect((await store.expenses.get(created.id))!.decidedBy).toEqual({
        id: a.members.owner,
        name: "e owner",
      });

      const at = new Date("2026-11-11T10:00:00Z");
      expect((await store.expenses.markUsed(created.id, at))!.usedAt).toEqual(at);
      expect(await store.expenses.markUsed("00000000-0000-4000-8000-000000000000", at)).toBeNull();
    });
  });

  it("hides requests of deleted jobs and of other organizations", async () => {
    await withStore(t.app, b.orgId, async (store) => {
      const theirs = (await store.expenses.listByJob(a.ids.job)).length;
      expect(theirs).toBe(0);
      const ours = await store.expenses.list({ limit: 50 });
      expect(ours.rows.every((r) => r.job.id === b.ids.job)).toBe(true);
      const aRow = await t.owner
        .select({ id: s.expenseRequest.id })
        .from(s.expenseRequest)
        .where(sql`${s.expenseRequest.organizationId} = ${a.orgId}`)
        .limit(1);
      expect(await store.expenses.get(aRow[0]!.id)).toBeNull();
      expect(
        await store.expenses.decide(aRow[0]!.id, {
          status: "approved",
          decidedByMemberId: b.members.owner,
          decidedAt: new Date(),
          comment: null,
        }),
      ).toBeNull();
    });
    await t.owner
      .update(s.job)
      .set({ deletedAt: new Date() })
      .where(sql`${s.job.id} = ${b.ids.job}`);
    await withStore(t.app, b.orgId, async (store) => {
      expect((await store.expenses.list({ limit: 50 })).rows).toHaveLength(0);
      expect(await store.expenses.countPending()).toBe(0);
    });
  });

  it("runs the request and approval services end to end", async () => {
    await withStore(t.app, a.orgId, async (store) => {
      const actor = (memberId: string, userId: string, role: Actor["role"]): ServiceContext => ({
        actor: { memberId, userId, role, organizationId: a.orgId, name: role },
        store,
        now: new Date(),
        demo: false,
      });
      const tech = actor(a.members.tech, a.users.tech, "technician");
      const req = await expenseService.requestExpense(tech, a.ids.job, {
        item: "Condensate pump",
        quantity: 1,
        unit_cost_minor: 12_900,
        reason: "Pump failed",
      });
      expect(req).toMatchObject({ status: "pending", totalMinor: 12_900, currency: "USD" });
      const dispatcher = actor(a.members.dispatcher, a.users.dispatcher, "dispatcher");
      const [result] = await expenseService.decideExpenses(dispatcher, {
        ids: [req.id],
        decision: "approve",
      });
      expect(result).toEqual({ id: req.id, ok: true, status: "approved" });
      const used = await expenseService.markExpenseUsed(tech, req.id);
      expect(used.usedAt).not.toBeNull();
      const events = await store.jobs.events(a.ids.job);
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining(["expense_requested", "expense_decided", "part_used"]),
      );
    });
  });
});
