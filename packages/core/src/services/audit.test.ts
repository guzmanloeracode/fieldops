import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../domain/errors";
import { world } from "../test/fixtures";
import { portalMemoryOf } from "../test/memory-portal";
import * as audit from "./audit";
import type { AuditEntryRecord } from "./audit-types";

function entry(n: number, extra: Partial<AuditEntryRecord> = {}): AuditEntryRecord {
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    createdAt: new Date(Date.UTC(2026, 10, 10, n)),
    actorUserId: null,
    actorName: null,
    action: "job.update",
    entityType: "job",
    entityId: "j1",
    before: { status: "new" },
    after: { status: "scheduled" },
    ip: null,
    userAgent: null,
    job: null,
    ...extra,
  };
}

describe("listAuditLog (AUD-03)", () => {
  it("is for owners and admins only", async () => {
    const w = world();
    await expect(audit.listAuditLog(w.ctx(w.dispatcher), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(audit.listAuditActors(w.ctx(w.tom))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await audit.listAuditLog(w.ctx(w.admin), {})).toEqual({ rows: [], nextCursor: null });
  });

  it("pages newest first with a keyset cursor", async () => {
    const w = world();
    portalMemoryOf(w.data).auditEntries.push(...[1, 2, 3, 4, 5].map((n) => entry(n)));
    const first = await audit.listAuditLog(w.ctx(w.owner), { limit: "2" });
    expect(first.rows.map((r) => r.createdAt.getUTCHours())).toEqual([5, 4]);
    const second = await audit.listAuditLog(w.ctx(w.owner), { limit: 2, cursor: first.nextCursor });
    expect(second.rows.map((r) => r.createdAt.getUTCHours())).toEqual([3, 2]);
    const last = await audit.listAuditLog(w.ctx(w.owner), { limit: 2, cursor: second.nextCursor });
    expect(last).toEqual({ rows: [expect.objectContaining({ id: entry(1).id })], nextCursor: null });
    await expect(audit.listAuditLog(w.ctx(w.owner), { cursor: "nope" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("filters by actor, system, entity, operation, entity id and local dates", async () => {
    const w = world();
    w.data.org.timezone = "America/Chicago";
    const u = w.owner.userId;
    portalMemoryOf(w.data).auditEntries.push(
      entry(1, {
        actorUserId: u,
        actorName: "Olivia Owner",
        action: "customer.insert",
        entityType: "customer",
        entityId: "c1",
      }),
      entry(3, {
        actorUserId: u,
        actorName: "Olivia Owner",
        action: "auth.sign_in",
        entityType: "user",
        entityId: u,
      }),
      entry(8, { action: "job.update" }),
      entry(20, {
        actorUserId: w.admin.userId,
        actorName: "Adam Admin",
        action: "member.update",
        entityType: "member",
      }),
    );
    const ids = async (q: Record<string, unknown>) =>
      (await audit.listAuditLog(w.ctx(w.owner), q)).rows.map((r) => r.createdAt.getUTCHours());
    expect(await ids({ actor: u })).toEqual([3, 1]);
    expect(await ids({ actor: "system" })).toEqual([8]);
    expect(await ids({ entity_type: "customer" })).toEqual([1]);
    expect(await ids({ operation: "sign_in" })).toEqual([3]);
    expect(await ids({ entity_id: "c1" })).toEqual([1]);
    // Nov 10 local (Chicago, UTC-6) runs from 06:00 UTC on the 10th to 06:00 UTC on the 11th.
    expect(await ids({ from: "2026-11-10", to: "2026-11-10" })).toEqual([20, 8]);
    expect(await ids({ to: "2026-11-09" })).toEqual([3, 1]);
    expect(await ids({ actor: "", entity_type: "", from: "" })).toEqual([20, 8, 3, 1]);
    await expect(ids({ entity_type: "password" })).rejects.toBeInstanceOf(ValidationError);
    expect(await audit.listAuditActors(w.ctx(w.admin))).toEqual([
      { userId: u, name: "Olivia Owner" },
      { userId: w.admin.userId, name: "Adam Admin" },
    ]);
  });
});

describe("audit helpers", () => {
  it("reads the operation of an action", () => {
    expect(audit.auditOperation("job.update")).toBe("update");
    expect(audit.auditOperation("auth.sign_in")).toBe("sign_in");
    expect(audit.auditOperation("odd")).toBe("odd");
  });

  it("lists changed fields, hiding bookkeeping and empty values of inserts and deletes", () => {
    expect(
      audit.auditChanges({
        before: { title: "A", updated_at: "x", notes: null },
        after: { title: "B", notes: "n" },
      }),
    ).toEqual([
      { field: "title", before: "A", after: "B" },
      { field: "notes", before: null, after: "n" },
    ]);
    expect(
      audit.auditChanges({
        before: null,
        after: {
          id: "1",
          organization_id: "o",
          name: "Cara",
          tags: [],
          notes: "",
          address: {},
          phone: null,
          vip: false,
        },
      }),
    ).toEqual([
      { field: "name", before: null, after: "Cara" },
      { field: "vip", before: null, after: false },
    ]);
    expect(audit.auditChanges({ before: { name: "Gone", deleted_at: null }, after: null })).toEqual([
      { field: "name", before: "Gone", after: null },
    ]);
    expect(audit.auditChanges({ before: null, after: null })).toEqual([]);
  });

  it("records sign-ins and sign-outs through the audit repository", async () => {
    const w = world();
    await audit.recordAuthEvent(w.store, "sign_in", w.owner.userId);
    await audit.recordAuthEvent(w.store, "sign_out", w.owner.userId);
    expect(portalMemoryOf(w.data).auditEvents).toEqual([
      { action: "auth.sign_in", entityType: "user", entityId: w.owner.userId, after: null },
      { action: "auth.sign_out", entityType: "user", entityId: w.owner.userId, after: null },
    ]);
  });
});
