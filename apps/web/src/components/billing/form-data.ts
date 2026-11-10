import "server-only";
import { customers, dates, organization, type ServiceContext } from "@fieldops/core";
import type { CustomerParties } from "@/components/billing/actions";

// What the quote and invoice forms need from the server: the currency, tax rates, services and a customer's sites
// and contacts.

export async function billingFormData(ctx: ServiceContext, customerId: string | null) {
  const [org, services] = await Promise.all([
    ctx.store.organization.get(),
    organization.listServiceTypes(ctx),
  ]);
  let customer: { id: string; name: string } | null = null;
  let parties: CustomerParties | null = null;
  if (customerId && /^[0-9a-f-]{36}$/i.test(customerId)) {
    const detail = await customers.getCustomerDetail(ctx, customerId).catch(() => null);
    if (detail) {
      customer = { id: detail.customer.id, name: detail.customer.name };
      parties = {
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
    }
  }
  return {
    currency: org.currency,
    taxRates: org.taxRates,
    defaultValidUntil: dates.addDays(
      dates.localDateString(ctx.now, org.timezone),
      org.settings.billing.quoteValidityDays,
    ),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      defaultPriceMinor: s.defaultPriceMinor,
      taxRateBps: s.taxRateBps ?? null,
    })),
    customer,
    parties,
  };
}
