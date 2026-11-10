import { ROLES, type Role } from "@fieldops/shared";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "./errors";
import { assertCan, can, canChangeRole, ROLE_LABELS, seesOnlyAssigned, type Action } from "./permissions";

// The expected matrix, written out independently of the implementation (PRD §5.2).
// "assigned" means allowed for a technician only when the resource is assigned to them.
type Expect = Record<Role, boolean | "assigned" | "threshold">;
const MATRIX: Record<Action, Expect> = {
  "org.update": { owner: true, admin: true, dispatcher: false, technician: false },
  "org.billing": { owner: true, admin: false, dispatcher: false, technician: false },
  "org.delete": { owner: true, admin: false, dispatcher: false, technician: false },
  "apiKeys.manage": { owner: true, admin: true, dispatcher: false, technician: false },
  "members.view": { owner: true, admin: true, dispatcher: true, technician: false },
  "members.invite": { owner: true, admin: true, dispatcher: false, technician: false },
  "members.update": { owner: true, admin: true, dispatcher: false, technician: false },
  "members.remove": { owner: true, admin: true, dispatcher: false, technician: false },
  "customers.view": { owner: true, admin: true, dispatcher: true, technician: "assigned" },
  "customers.create": { owner: true, admin: true, dispatcher: true, technician: false },
  "customers.update": { owner: true, admin: true, dispatcher: true, technician: false },
  "customers.delete": { owner: true, admin: true, dispatcher: false, technician: false },
  "jobs.view": { owner: true, admin: true, dispatcher: true, technician: "assigned" },
  "jobs.create": { owner: true, admin: true, dispatcher: true, technician: false },
  "jobs.update": { owner: true, admin: true, dispatcher: true, technician: false },
  "jobs.assign": { owner: true, admin: true, dispatcher: true, technician: false },
  "jobs.delete": { owner: true, admin: true, dispatcher: false, technician: false },
  "jobs.work": { owner: true, admin: true, dispatcher: true, technician: "assigned" },
  "jobs.reopen": { owner: true, admin: true, dispatcher: true, technician: false },
  "serviceTypes.view": { owner: true, admin: true, dispatcher: true, technician: true },
  "serviceTypes.manage": { owner: true, admin: true, dispatcher: false, technician: false },
  "expenses.approve": { owner: true, admin: true, dispatcher: "threshold", technician: false },
  "expenses.request": { owner: true, admin: true, dispatcher: true, technician: "assigned" },
  "expenses.view": { owner: true, admin: true, dispatcher: true, technician: "assigned" },
  "schedule.view": { owner: true, admin: true, dispatcher: true, technician: false },
  "availability.manage": { owner: true, admin: true, dispatcher: true, technician: false },
  "time.edit": { owner: true, admin: true, dispatcher: true, technician: "assigned" },
  "views.share": { owner: true, admin: true, dispatcher: true, technician: false },
  "settings.operations": { owner: true, admin: true, dispatcher: false, technician: false },
  "dashboard.own": { owner: true, admin: true, dispatcher: true, technician: true },
  "billing.manage": { owner: true, admin: true, dispatcher: true, technician: false },
  "dashboard.operational": { owner: true, admin: true, dispatcher: true, technician: false },
  "dashboard.financial": { owner: true, admin: true, dispatcher: false, technician: false },
  "audit.view": { owner: true, admin: true, dispatcher: false, technician: false },
  "ai.use": { owner: true, admin: true, dispatcher: true, technician: "assigned" },
  "ai.manage": { owner: true, admin: true, dispatcher: false, technician: false },
  "sla.manage": { owner: true, admin: true, dispatcher: false, technician: false },
  "demoOutbox.view": { owner: true, admin: true, dispatcher: false, technician: false },
};

describe("permission matrix", () => {
  for (const [action, row] of Object.entries(MATRIX) as [Action, Expect][]) {
    for (const role of ROLES) {
      const expected = row[role];
      it(`${role} → ${action}`, () => {
        if (expected === "assigned") {
          expect(can({ role }, action)).toBe(false);
          expect(can({ role }, action, { assigned: false })).toBe(false);
          expect(can({ role }, action, { assigned: true })).toBe(true);
        } else if (expected === "threshold") {
          expect(can({ role }, action)).toBe(false);
          expect(can({ role }, action, { belowDispatcherThreshold: true })).toBe(true);
        } else {
          expect(can({ role }, action)).toBe(expected);
          // Scope never widens a role that has no rule for it.
          expect(can({ role }, action, { assigned: true, belowDispatcherThreshold: true })).toBe(
            expected || action === "serviceTypes.view",
          );
        }
      });
    }
  }

  it("office roles don't need the assigned scope", () => {
    for (const role of ["owner", "admin", "dispatcher"] as const) {
      expect(can({ role }, "jobs.view", { assigned: false })).toBe(true);
    }
  });

  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan({ role: "technician" }, "jobs.create")).toThrow(ForbiddenError);
    expect(() => assertCan({ role: "dispatcher" }, "jobs.create")).not.toThrow();
    expect(() => assertCan({ role: "technician" }, "jobs.view", { assigned: true })).not.toThrow();
  });

  it("only technicians are limited to assigned work", () => {
    expect(seesOnlyAssigned({ role: "technician" })).toBe(true);
    for (const role of ["owner", "admin", "dispatcher"] as const)
      expect(seesOnlyAssigned({ role })).toBe(false);
  });

  it("labels every role", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLES].sort());
  });
});

describe("canChangeRole", () => {
  it("owners can grant and revoke any role", () => {
    for (const from of ROLES)
      for (const to of ROLES) expect(canChangeRole({ role: "owner" }, from, to)).toBe(true);
  });
  it("admins can't touch the owner role", () => {
    expect(canChangeRole({ role: "admin" }, "dispatcher", "technician")).toBe(true);
    expect(canChangeRole({ role: "admin" }, "technician", "admin")).toBe(true);
    expect(canChangeRole({ role: "admin" }, "technician", "owner")).toBe(false);
    expect(canChangeRole({ role: "admin" }, "owner", "admin")).toBe(false);
  });
  it("dispatchers and technicians can't change roles", () => {
    expect(canChangeRole({ role: "dispatcher" }, "technician", "dispatcher")).toBe(false);
    expect(canChangeRole({ role: "technician" }, "technician", "dispatcher")).toBe(false);
  });
});
