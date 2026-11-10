import {
  billingSettingsSchema,
  catalogItemInputSchema,
  catalogItemUpdateSchema,
  catalogQuerySchema,
  type CatalogQuery,
} from "@fieldops/shared";
import { ConflictError, ForbiddenError, NotFoundError } from "../domain/errors";
import { assertCan, can } from "../domain/permissions";
import { UUID, checkTaxRate } from "./billing-common";
import type { CatalogItemRecord } from "./billing-types";
import { parseInput } from "./validate";
import type { OrganizationRecord, ServiceContext } from "./types";

// The parts and fees catalog (FIN-01) and the billing settings (FIN-02, FIN-03, FIN-06). Services and their prices
// are the service types; their tax rate is set with `serviceTypeTaxRate`.

/** Owners and admins manage the catalog; everyone who builds quotes and invoices can search it. */
function assertCanRead(ctx: ServiceContext) {
  if (!can(ctx.actor, "catalog.manage") && !can(ctx.actor, "billing.manage")) throw new ForbiddenError();
}

export async function listCatalog(ctx: ServiceContext, raw: unknown = {}): Promise<CatalogItemRecord[]> {
  assertCanRead(ctx);
  const q: CatalogQuery = parseInput(catalogQuerySchema, raw ?? {});
  return ctx.store.billing.listCatalog({
    q: q.q,
    kind: q.kind,
    includeInactive: q.include_inactive && can(ctx.actor, "catalog.manage"),
    limit: q.limit,
  });
}

/** Active parts and fees whose name or SKU matches, for the line pickers. */
export async function searchCatalog(ctx: ServiceContext, q: string, limit = 20) {
  return listCatalog(ctx, { q: q.trim() || undefined, limit });
}

export async function getCatalogItem(ctx: ServiceContext, id: string): Promise<CatalogItemRecord> {
  assertCanRead(ctx);
  const item = UUID.test(id) ? await ctx.store.billing.getCatalogItem(id) : null;
  if (!item) throw new NotFoundError("Catalog item");
  return item;
}

async function assertSkuFree(ctx: ServiceContext, sku: string | null | undefined, exceptId?: string) {
  if (!sku) return;
  const other = await ctx.store.billing.findCatalogItemBySku(sku);
  if (other && other.id !== exceptId) {
    throw new ConflictError(`SKU ${sku} is already used by ${other.name}`, {
      fields: [{ path: "sku", message: "Already used by another item" }],
    });
  }
}

export async function createCatalogItem(ctx: ServiceContext, raw: unknown): Promise<CatalogItemRecord> {
  assertCan(ctx.actor, "catalog.manage");
  const input = parseInput(catalogItemInputSchema, raw);
  const org = await ctx.store.organization.get();
  checkTaxRate(org, input.tax_rate_bps);
  await assertSkuFree(ctx, input.sku);
  return ctx.store.billing.createCatalogItem({
    kind: input.kind,
    name: input.name,
    description: input.description ?? null,
    sku: input.sku ?? null,
    unit: input.unit,
    unitPriceMinor: input.unit_price_minor,
    unitCostMinor: input.unit_cost_minor ?? null,
    currency: org.currency,
    taxRateBps: input.tax_rate_bps ?? null,
    active: input.active,
  });
}

export async function updateCatalogItem(
  ctx: ServiceContext,
  id: string,
  raw: unknown,
): Promise<CatalogItemRecord> {
  assertCan(ctx.actor, "catalog.manage");
  const input = parseInput(catalogItemUpdateSchema, raw);
  const item = await getCatalogItem(ctx, id);
  if (input.tax_rate_bps !== undefined) checkTaxRate(await ctx.store.organization.get(), input.tax_rate_bps);
  if (input.sku !== undefined) await assertSkuFree(ctx, input.sku, item.id);
  const updated = await ctx.store.billing.updateCatalogItem(item.id, {
    ...(input.kind !== undefined && { kind: input.kind }),
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description ?? null }),
    ...(input.sku !== undefined && { sku: input.sku ?? null }),
    ...(input.unit !== undefined && { unit: input.unit }),
    ...(input.unit_price_minor !== undefined && { unitPriceMinor: input.unit_price_minor }),
    ...(input.unit_cost_minor !== undefined && { unitCostMinor: input.unit_cost_minor }),
    ...(input.tax_rate_bps !== undefined && { taxRateBps: input.tax_rate_bps }),
    ...(input.active !== undefined && { active: input.active }),
  });
  return updated!;
}

// ------------------------------------------------------------------ billing settings

export interface BillingSettingsView {
  currency: OrganizationRecord["currency"];
  taxRates: OrganizationRecord["taxRates"];
  billing: OrganizationRecord["settings"]["billing"];
}

export async function getBillingSettings(ctx: ServiceContext): Promise<BillingSettingsView> {
  assertCan(ctx.actor, "billing.settings");
  const org = await ctx.store.organization.get();
  return { currency: org.currency, taxRates: org.taxRates, billing: org.settings.billing };
}

export async function updateBillingSettings(ctx: ServiceContext, raw: unknown): Promise<BillingSettingsView> {
  assertCan(ctx.actor, "billing.settings");
  const input = parseInput(billingSettingsSchema, raw);
  const current = await ctx.store.organization.get();
  const org = await ctx.store.organization.update({
    settings: {
      ...current.settings,
      billing: {
        paymentTermsDays: input.payment_terms_days,
        quoteValidityDays: input.quote_validity_days,
        laborRateMinor: input.labor_rate_minor,
        invoicePrefix: input.invoice_prefix,
        quotePrefix: input.quote_prefix,
        remindersEnabled: input.reminders_enabled,
        paymentInstructions: input.payment_instructions ?? null,
      },
    },
  });
  return { currency: org.currency, taxRates: org.taxRates, billing: org.settings.billing };
}
