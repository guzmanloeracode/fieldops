import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { world } from "../test/fixtures";
import * as customers from "./customers";
import * as jobs from "./jobs";

describe("equipment (CUS-03)", () => {
  it("creates, updates and soft-deletes units for office roles", async () => {
    const w = world();
    const ctx = w.ctx(w.dispatcher);
    const unit = await customers.createEquipment(ctx, w.siteId, {
      type: "Heat pump",
      brand: "Daikin",
      serial: "",
      install_date: "2024-05-01",
      warranty_end: "2029-05-01",
    });
    expect(unit).toMatchObject({
      siteId: w.siteId,
      type: "Heat pump",
      brand: "Daikin",
      model: null,
      serial: null,
      installDate: "2024-05-01",
      warrantyEnd: "2029-05-01",
      notes: null,
    });
    const updated = await customers.updateEquipment(ctx, unit.id, { model: "FTX-25", notes: "Roof unit" });
    expect(updated).toMatchObject({ model: "FTX-25", notes: "Roof unit", brand: "Daikin" });
    const full = await customers.updateEquipment(ctx, unit.id, {
      type: "Heat pump 2",
      brand: null,
      serial: "SN1",
      install_date: null,
      warranty_end: "",
    });
    expect(full).toMatchObject({
      type: "Heat pump 2",
      brand: null,
      serial: "SN1",
      installDate: null,
      warrantyEnd: null,
    });

    await expect(
      customers.updateEquipment(ctx, unit.id, { install_date: "2030-01-01", warranty_end: "2029-01-01" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      customers.createEquipment(ctx, w.siteId, {
        type: "X",
        install_date: "2024-01-02",
        warranty_end: "2024-01-01",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(customers.createEquipment(ctx, "missing", { type: "X" })).rejects.toThrow(NotFoundError);
    await expect(customers.updateEquipment(ctx, "missing", { type: "X" })).rejects.toThrow(NotFoundError);
    await expect(customers.createEquipment(w.ctx(w.tom), w.siteId, { type: "X" })).rejects.toThrow(
      ForbiddenError,
    );

    await customers.deleteEquipment(ctx, unit.id);
    await expect(customers.deleteEquipment(ctx, unit.id)).rejects.toThrow(NotFoundError);
    await expect(customers.getEquipment(ctx, unit.id)).rejects.toThrow(NotFoundError);
  });

  it("shows details and service history; technicians only reach units at their jobs' sites", async () => {
    const w = world();
    const j1 = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      equipment_id: w.equipmentId,
      title: "Service the unit",
    });
    const j2 = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      equipment_id: w.equipmentId,
      title: "Second visit",
    });
    w.data.jobs.find((j) => j.id === j2.id)!.createdAt = new Date(Date.now() + 1000);

    const office = await customers.getEquipmentDetail(w.ctx(w.owner), w.equipmentId);
    expect(office.site.id).toBe(w.siteId);
    expect(office.customer.name).toBe("Cara Customer");
    expect(office.history.map((h) => h.title)).toEqual(["Second visit", "Service the unit"]);

    await expect(customers.getEquipmentDetail(w.ctx(w.tom), w.equipmentId)).rejects.toThrow(NotFoundError);
    await jobs.assignJob(w.ctx(w.dispatcher), j1.id, { member_ids: [w.tom.id] });
    const tech = await customers.getEquipmentDetail(w.ctx(w.tom), w.equipmentId);
    expect(tech.history.map((h) => [h.title, h.technicians])).toEqual([["Service the unit", ["Tom Tech"]]]);
    await expect(customers.getEquipment(w.ctx(w.owner), "missing")).rejects.toThrow(NotFoundError);
  });
});
