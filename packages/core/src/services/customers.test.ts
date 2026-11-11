import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { ADDRESS, world } from "../test/fixtures";
import * as customers from "./customers";
import * as jobs from "./jobs";

const listQuery = { sort: "name" as const, limit: 50 };

describe("customer services", () => {
  it("creates a customer with contacts, marking the first as primary, and warns about duplicates", async () => {
    const w = world();
    const r = await customers.createCustomer(w.ctx(w.dispatcher), {
      name: "  Cara Again ",
      tags: ["VIP", "vip", "Gate code"],
      contacts: [
        { name: "Cara", email: "CARA@example.com" },
        { name: "Sam", phone: "512-555-0199" },
      ],
    });
    expect(r.customer.name).toBe("Cara Again");
    expect(r.customer.tags).toEqual(["VIP", "Gate code"]);
    expect(r.contacts.map((c) => c.isPrimary)).toEqual([true, false]);
    expect(r.duplicates).toEqual([{ id: w.customerId, name: "Cara Customer", matchedOn: "email" }]);
    const stored = w.data.contacts.find((c) => c.id === r.contacts[1]!.id)!;
    expect(stored.phoneNorm).toBe("15125550199");
  });

  it("keeps an explicit primary contact", async () => {
    const w = world();
    const r = await customers.createCustomer(w.ctx(w.owner), {
      name: "Two contacts",
      contacts: [{ name: "A" }, { name: "B", is_primary: true }],
    });
    expect(r.contacts.map((c) => c.isPrimary)).toEqual([false, true]);
    expect(r.duplicates).toEqual([]);
  });

  it("finds duplicates by normalized phone", async () => {
    const w = world();
    const dups = await customers.findDuplicateCustomers(w.ctx(w.dispatcher), {
      emails: [null],
      phones: ["+1 512 555 0142"],
    });
    expect(dups).toEqual([{ id: w.customerId, name: "Cara Customer", matchedOn: "phone" }]);
    expect(
      await customers.findDuplicateCustomers(w.ctx(w.dispatcher), { emails: [""], phones: ["12"] }),
    ).toEqual([]);
  });

  it("validates input with field paths", async () => {
    const w = world();
    await expect(customers.createCustomer(w.ctx(w.owner), { name: "" })).rejects.toMatchObject({
      code: "validation",
      fields: [expect.objectContaining({ path: "name" })],
    });
    await expect(
      customers.createCustomer(w.ctx(w.owner), {
        name: "X",
        contacts: [{ name: "Y", email: "not-an-email" }],
      }),
    ).rejects.toMatchObject({ fields: [expect.objectContaining({ path: "contacts.0.email" })] });
  });

  it("does not let technicians create, update or delete customers", async () => {
    const w = world();
    await expect(customers.createCustomer(w.ctx(w.tom), { name: "X" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(customers.updateCustomer(w.ctx(w.tom), w.customerId, { name: "X" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(customers.deleteCustomer(w.ctx(w.dispatcher), w.customerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      customers.createSite(w.ctx(w.tom), w.customerId, { label: "x", address: ADDRESS }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      customers.findDuplicateCustomers(w.ctx(w.tom), { emails: [], phones: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows technicians only customers and sites of their assigned jobs, as not found otherwise", async () => {
    const w = world();
    await expect(customers.getCustomer(w.ctx(w.tom), w.customerId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(customers.getSite(w.ctx(w.tom), w.siteId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await customers.listCustomers(w.ctx(w.tom), listQuery)).rows).toEqual([]);

    const job = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Leak",
    });
    await jobs.assignJob(w.ctx(w.dispatcher), job.id, { member_ids: [w.tom.id] });

    expect((await customers.getCustomer(w.ctx(w.tom), w.customerId)).name).toBe("Cara Customer");
    expect((await customers.getSite(w.ctx(w.tom), w.siteId)).id).toBe(w.siteId);
    expect((await customers.listCustomers(w.ctx(w.tom), listQuery)).rows.map((c) => c.id)).toEqual([
      w.customerId,
    ]);
    await expect(customers.getCustomer(w.ctx(w.rina), w.customerId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(customers.getCustomer(w.ctx(w.tom), w.otherCustomerId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns customer detail with contacts, sites and stats", async () => {
    const w = world();
    await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Leak",
    });
    const d = await customers.getCustomerDetail(w.ctx(w.owner), w.customerId);
    expect(d.contacts).toHaveLength(1);
    expect(d.sites.map((s) => s.id)).toEqual([w.siteId]);
    expect(d.stats).toMatchObject({ jobCount: 1, openJobCount: 1, completedJobCount: 0 });
    await expect(customers.getCustomerDetail(w.ctx(w.owner), "missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("updates only the fields that were sent", async () => {
    const w = world();
    const c = await customers.updateCustomer(w.ctx(w.dispatcher), w.customerId, {
      notes: "Gate code 1234",
      tags: ["A", "a"],
    });
    expect(c).toMatchObject({ name: "Cara Customer", notes: "Gate code 1234", tags: ["A"] });
    const c2 = await customers.updateCustomer(w.ctx(w.dispatcher), w.customerId, {
      type: "commercial",
      name: "Cara Ltd",
      billing_address: ADDRESS,
    });
    expect(c2).toMatchObject({ type: "commercial", name: "Cara Ltd", billingAddress: ADDRESS });
    expect(c2.locale ?? null).toBeNull();
    await expect(
      customers.updateCustomer(w.ctx(w.dispatcher), "missing", { name: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps the customer's language, or null to follow the organization (SET-05)", async () => {
    const w = world();
    const { customer } = await customers.createCustomer(w.ctx(w.dispatcher), { name: "Budi", locale: "id" });
    expect(customer.locale).toBe("id");
    expect((await customers.createCustomer(w.ctx(w.dispatcher), { name: "Ann" })).customer.locale).toBeNull();
    const back = await customers.updateCustomer(w.ctx(w.dispatcher), customer.id, { locale: null });
    expect(back.locale).toBeNull();
    expect((await customers.updateCustomer(w.ctx(w.dispatcher), customer.id, { locale: "en" })).locale).toBe(
      "en",
    );
    await expect(
      customers.updateCustomer(w.ctx(w.dispatcher), customer.id, { locale: "fr" }),
    ).rejects.toMatchObject({ fields: [{ path: "locale" }] });
  });

  it("soft-deletes customers (managers only)", async () => {
    const w = world();
    await customers.deleteCustomer(w.ctx(w.admin), w.customerId);
    await expect(customers.getCustomer(w.ctx(w.admin), w.customerId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(customers.deleteCustomer(w.ctx(w.admin), w.customerId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("creates, lists and updates sites", async () => {
    const w = world();
    const site = await customers.createSite(w.ctx(w.dispatcher), w.customerId, {
      label: "Office",
      address: ADDRESS,
      latitude: 30.2,
      longitude: -97.7,
      access_notes: "",
    });
    expect(site).toMatchObject({ label: "Office", accessNotes: null, latitude: 30.2 });
    expect((await customers.listSites(w.ctx(w.owner), w.customerId)).map((s) => s.label)).toEqual([
      "Home",
      "Office",
    ]);
    const updated = await customers.updateSite(w.ctx(w.dispatcher), site.id, {
      label: "HQ",
      address: { ...ADDRESS, city: "Round Rock" },
      latitude: null,
      longitude: null,
      access_notes: "Back door",
      onsite_contact_name: "Ann",
      onsite_contact_phone: "555",
    });
    expect(updated).toMatchObject({
      label: "HQ",
      accessNotes: "Back door",
      onsiteContactName: "Ann",
      latitude: null,
    });
    expect(updated.address.city).toBe("Round Rock");
    await expect(
      customers.createSite(w.ctx(w.dispatcher), "missing", { label: "x", address: ADDRESS }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(customers.updateSite(w.ctx(w.dispatcher), "missing", { label: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(customers.getSite(w.ctx(w.owner), "missing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      customers.createSite(w.ctx(w.dispatcher), w.customerId, {
        label: "x",
        address: { ...ADDRESS, country: "USA" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists equipment at a visible site", async () => {
    const w = world();
    expect(await customers.listSiteEquipment(w.ctx(w.owner), w.siteId)).toHaveLength(1);
    await expect(customers.listSiteEquipment(w.ctx(w.tom), w.siteId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
