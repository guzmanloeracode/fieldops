"use server";
import { assertCan, catalog, customers } from "@fieldops/core";
import { action, runService } from "@/server/context";

// Lookups for the quote and invoice forms (office roles): customers, a customer's sites and contacts, and the
// parts and fees catalog.

export interface CustomerOption {
  id: string;
  name: string;
}

export interface CustomerParties {
  sites: { id: string; label: string; line1: string; city: string }[];
  contacts: { id: string; name: string; email: string | null; isPrimary: boolean }[];
}

export interface CatalogOption {
  id: string;
  kind: "part" | "fee";
  name: string;
  sku: string | null;
  unit: string;
  unitPriceMinor: number;
  taxRateBps: number | null;
}

export async function billingCustomersAction(q: string) {
  return action(() =>
    runService(async (ctx) => {
      assertCan(ctx.actor, "billing.manage");
      const page = await customers.listCustomers(ctx, { q: q || undefined, sort: "name", limit: 12 });
      return page.rows.map((c): CustomerOption => ({ id: c.id, name: c.name }));
    }),
  );
}

export async function customerPartiesAction(customerId: string) {
  return action(() =>
    runService(async (ctx): Promise<CustomerParties> => {
      assertCan(ctx.actor, "billing.manage");
      const detail = await customers.getCustomerDetail(ctx, customerId);
      return {
        sites: detail.sites.map((s) => ({
          id: s.id,
          label: s.label,
          line1: s.address.line1,
          city: s.address.city,
        })),
        contacts: detail.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          isPrimary: c.isPrimary,
        })),
      };
    }),
  );
}

export async function searchCatalogAction(q: string) {
  return action(() =>
    runService(async (ctx) =>
      (await catalog.searchCatalog(ctx, q, 15)).map((c): CatalogOption => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        sku: c.sku,
        unit: c.unit,
        unitPriceMinor: c.unitPriceMinor,
        taxRateBps: c.taxRateBps,
      })),
    ),
  );
}
