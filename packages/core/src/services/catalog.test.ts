import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { billingWorld } from "../test/billing-world";
import * as catalog from "./catalog";
import * as organization from "./organization";

describe("catalog", () => {
  it("creates parts and fees in the organization's currency", async () => {
    const w = billingWorld();
    const part = await catalog.createCatalogItem(w.ctx(w.owner), {
      name: "Capacitor 35/5 µF",
      sku: "CAP-355",
      unit_price_minor: 3900,
      unit_cost_minor: 2400,
      tax_rate_bps: 500,
    });
    expect(part).toMatchObject({
      kind: "part",
      unit: "each",
      currency: "USD",
      sku: "CAP-355",
      taxRateBps: 500,
      active: true,
    });
    const fee = await catalog.createCatalogItem(w.ctx(w.admin), {
      kind: "fee",
      name: "Call-out fee",
      description: "",
      unit_price_minor: 7500,
    });
    expect(fee).toMatchObject({
      kind: "fee",
      sku: null,
      description: null,
      taxRateBps: null,
      unitCostMinor: null,
    });
  });

  it("only accepts the organization's tax rates", async () => {
    const w = billingWorld();
    await expect(
      catalog.createCatalogItem(w.ctx(w.owner), { name: "X", unit_price_minor: 1, tax_rate_bps: 1234 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps SKUs unique", async () => {
    const w = billingWorld();
    const a = await catalog.createCatalogItem(w.ctx(w.owner), { name: "A", sku: "S1", unit_price_minor: 1 });
    await expect(
      catalog.createCatalogItem(w.ctx(w.owner), { name: "B", sku: "S1", unit_price_minor: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(catalog.updateCatalogItem(w.ctx(w.owner), a.id, { sku: "S1" })).resolves.toMatchObject({
      sku: "S1",
    });
  });

  it("updates every field", async () => {
    const w = billingWorld();
    const a = await catalog.createCatalogItem(w.ctx(w.owner), { name: "A", unit_price_minor: 1 });
    const u = await catalog.updateCatalogItem(w.ctx(w.owner), a.id, {
      kind: "fee",
      name: "B",
      description: "Desc",
      sku: "",
      unit: "m",
      unit_price_minor: 2,
      unit_cost_minor: 1,
      tax_rate_bps: 825,
      active: false,
    });
    expect(u).toMatchObject({
      kind: "fee",
      name: "B",
      description: "Desc",
      sku: null,
      unit: "m",
      unitPriceMinor: 2,
      unitCostMinor: 1,
      taxRateBps: 825,
      active: false,
    });
    await expect(catalog.updateCatalogItem(w.ctx(w.owner), a.id, { tax_rate_bps: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("lets office roles search active items; managers see inactive ones", async () => {
    const w = billingWorld();
    await catalog.createCatalogItem(w.ctx(w.owner), {
      name: "Filter 16x25",
      sku: "FLT-1625",
      unit_price_minor: 1,
    });
    await catalog.createCatalogItem(w.ctx(w.owner), {
      name: "Old filter",
      unit_price_minor: 1,
      active: false,
    });
    expect((await catalog.searchCatalog(w.ctx(w.dispatcher), "flt")).map((c) => c.name)).toEqual([
      "Filter 16x25",
    ]);
    expect(await catalog.searchCatalog(w.ctx(w.dispatcher), "  ")).toHaveLength(1);
    expect(await catalog.listCatalog(w.ctx(w.dispatcher), { include_inactive: "true" })).toHaveLength(1);
    expect(await catalog.listCatalog(w.ctx(w.owner), { include_inactive: "true" })).toHaveLength(2);
    expect(await catalog.listCatalog(w.ctx(w.owner), undefined)).toHaveLength(1);
    expect(await catalog.listCatalog(w.ctx(w.owner), { kind: "fee" })).toHaveLength(0);
  });

  it("is managed by owners and admins, hidden from technicians", async () => {
    const w = billingWorld();
    await expect(
      catalog.createCatalogItem(w.ctx(w.dispatcher), { name: "A", unit_price_minor: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(catalog.listCatalog(w.ctx(w.tom))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(catalog.getCatalogItem(w.ctx(w.owner), "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("billing settings", () => {
  it("reads and saves the billing settings", async () => {
    const w = billingWorld();
    const before = await catalog.getBillingSettings(w.ctx(w.admin));
    expect(before.billing.paymentTermsDays).toBe(14);
    expect(before.taxRates).toHaveLength(2);
    const after = await catalog.updateBillingSettings(w.ctx(w.admin), {
      payment_terms_days: 30,
      quote_validity_days: 14,
      labor_rate_minor: 12000,
      invoice_prefix: "inv",
      quote_prefix: "est",
      reminders_enabled: false,
      payment_instructions: "Bank: 123",
    });
    expect(after.billing).toEqual({
      paymentTermsDays: 30,
      quoteValidityDays: 14,
      laborRateMinor: 12000,
      invoicePrefix: "INV",
      quotePrefix: "EST",
      remindersEnabled: false,
      paymentInstructions: "Bank: 123",
    });
    expect(w.data.org.settings.approval.autoApproveBelowMinor).toBe(5000);
  });

  it("needs different prefixes and a manager", async () => {
    const w = billingWorld();
    const input = {
      payment_terms_days: 30,
      quote_validity_days: 14,
      labor_rate_minor: 0,
      invoice_prefix: "DOC",
      quote_prefix: "DOC",
      reminders_enabled: true,
    };
    await expect(catalog.updateBillingSettings(w.ctx(w.owner), input)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(catalog.getBillingSettings(w.ctx(w.dispatcher))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("service type tax rates", () => {
  it("stores one of the organization's rates or the default", async () => {
    const w = billingWorld();
    const st = await organization.createServiceType(w.ctx(w.owner), { name: "Install", tax_rate_bps: 500 });
    expect(st.taxRateBps).toBe(500);
    const u = await organization.updateServiceType(w.ctx(w.owner), st.id, { tax_rate_bps: null });
    expect(u.taxRateBps).toBeNull();
    await expect(
      organization.createServiceType(w.ctx(w.owner), { name: "Bad", tax_rate_bps: 999 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      organization.updateServiceType(w.ctx(w.owner), st.id, { tax_rate_bps: 999 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const plain = await organization.createServiceType(w.ctx(w.owner), { name: "Plain" });
    expect(plain.taxRateBps).toBeNull();
  });
});
