import { describe, expect, it } from "vitest";
import { ConflictError, DemoRestrictedError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { ADDRESS, world } from "../test/fixtures";
import { member } from "../test/memory-store";
import * as org from "./organization";

describe("organization settings", () => {
  it("lets owners and admins update the profile", async () => {
    const w = world();
    const updated = await org.updateOrganization(w.ctx(w.admin), {
      name: "Acme Air & Clean",
      timezone: "America/Chicago",
      currency: "USD",
      country: "us",
      brand_color: "#0EA5E9",
      address: ADDRESS,
      business_hours: [{ day: 1, open: "08:00", close: "17:00" }],
      tax_rates: [{ name: "Sales tax", rate_bps: 825 }],
    });
    expect(updated).toMatchObject({ name: "Acme Air & Clean", country: "US", brandColor: "#0EA5E9", timezone: "America/Chicago" });
    expect(updated.taxRates).toEqual([{ name: "Sales tax", rate_bps: 825, default: false }]);
    expect((await org.getOrganization(w.ctx(w.tom))).name).toBe("Acme Air & Clean");
    expect((await org.updateOrganization(w.ctx(w.owner), { brand_color: null })).brandColor).toBeNull();
  });

  it("rejects dispatchers and bad values", async () => {
    const w = world();
    await expect(org.updateOrganization(w.ctx(w.dispatcher), { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(org.updateOrganization(w.ctx(w.owner), { brand_color: "blue" })).rejects.toMatchObject({ fields: [{ path: "brand_color" }] });
    await expect(org.updateOrganization(w.ctx(w.owner), { business_hours: [{ day: 1, open: "8am", close: "17:00" }] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("members", () => {
  it("lists members for the office and assignable members for dispatchers", async () => {
    const w = world();
    expect(await org.listMembers(w.ctx(w.dispatcher))).toHaveLength(5);
    await expect(org.listMembers(w.ctx(w.tom))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await org.listAssignableMembers(w.ctx(w.dispatcher))).toHaveLength(5);
    await expect(org.listAssignableMembers(w.ctx(w.tom))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only owners grant or revoke the owner role", async () => {
    const w = world();
    await org.changeMemberRole(w.ctx(w.admin), w.tom.id, "dispatcher");
    expect(w.data.members.find((m) => m.id === w.tom.id)!.role).toBe("dispatcher");
    await expect(org.changeMemberRole(w.ctx(w.admin), w.tom.id, "owner")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(org.changeMemberRole(w.ctx(w.admin), w.owner.id, "admin")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(org.changeMemberRole(w.ctx(w.dispatcher), w.rina.id, "admin")).rejects.toBeInstanceOf(ForbiddenError);
    await org.changeMemberRole(w.ctx(w.owner), w.admin.id, "owner");
    await org.changeMemberRole(w.ctx(w.owner), w.owner.id, "admin");
    expect(w.data.members.filter((m) => m.role === "owner").map((m) => m.id)).toEqual([w.admin.id]);
  });

  it("keeps at least one owner", async () => {
    const w = world();
    await expect(org.changeMemberRole(w.ctx(w.owner), w.owner.id, "admin")).rejects.toBeInstanceOf(ConflictError);
    await expect(org.changeMemberRole(w.ctx(w.owner), "missing", "admin")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("protects demo accounts in the demo", async () => {
    const w = world();
    const demoTech = member("technician", "Demo Tech", { isDemo: true });
    w.data.members.push(demoTech);
    await expect(org.changeMemberRole(w.ctx(w.owner, { demo: true }), demoTech.id, "dispatcher")).rejects.toBeInstanceOf(DemoRestrictedError);
    await expect(org.removeMember(w.ctx(w.owner, { demo: true }), demoTech.id)).rejects.toBeInstanceOf(DemoRestrictedError);
    await org.changeMemberRole(w.ctx(w.owner), demoTech.id, "dispatcher");
  });

  it("removes members with the right guards", async () => {
    const w = world();
    await org.removeMember(w.ctx(w.admin), w.rina.id);
    expect(w.data.members.some((m) => m.id === w.rina.id)).toBe(false);
    await expect(org.removeMember(w.ctx(w.admin), w.owner.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(org.removeMember(w.ctx(w.admin), w.admin.id)).rejects.toThrow(/yourself/);
    await expect(org.removeMember(w.ctx(w.dispatcher), w.tom.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(org.removeMember(w.ctx(w.admin), "missing")).rejects.toBeInstanceOf(NotFoundError);
    const second = member("owner", "Second Owner");
    w.data.members.push(second);
    await org.removeMember(w.ctx(w.owner), second.id);
  });

  it("refuses to remove the last owner", async () => {
    const w = world();
    const other = member("owner", "Other");
    w.data.members.push(other);
    await org.removeMember(w.ctx(other), w.owner.id);
    // `other` is now the only owner; a fresh owner actor can't remove them.
    const ghost = member("owner", "Ghost");
    await expect(org.removeMember(w.ctx(ghost), other.id)).rejects.toThrow(/at least one owner/);
  });
});

describe("service types", () => {
  it("lists active types for everyone and manages them for owners and admins", async () => {
    const w = world();
    const created = await org.createServiceType(w.ctx(w.admin), { name: "Duct cleaning", default_duration_min: 180, default_price_minor: 34900 });
    expect(created).toMatchObject({ name: "Duct cleaning", currency: "USD", active: true, description: null, color: null });
    expect((await org.listServiceTypes(w.ctx(w.tom))).map((s) => s.name)).toEqual(["AC repair", "Duct cleaning"]);
    const off = await org.updateServiceType(w.ctx(w.owner), created.id, {
      active: false,
      name: "Duct clean",
      description: "Whole house",
      default_duration_min: 150,
      default_price_minor: 29900,
      color: "#123456",
    });
    expect(off).toMatchObject({ active: false, name: "Duct clean", defaultDurationMin: 150, color: "#123456" });
    expect(await org.listServiceTypes(w.ctx(w.tom))).toHaveLength(1);
    expect(await org.listServiceTypes(w.ctx(w.owner), { includeInactive: true })).toHaveLength(2);
    await expect(org.createServiceType(w.ctx(w.dispatcher), { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(org.updateServiceType(w.ctx(w.owner), "missing", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(org.createServiceType(w.ctx(w.owner), { name: "" })).rejects.toBeInstanceOf(ValidationError);
  });
});
