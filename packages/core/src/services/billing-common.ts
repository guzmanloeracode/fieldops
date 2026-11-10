import type { Currency, DiscountType, Locale } from "@fieldops/shared";
import { computeTotals, type DocumentTotals } from "../domain/billing";
import { localDateString } from "../domain/date-range";
import { NotFoundError, ValidationError } from "../domain/errors";
import { formatMoney } from "../domain/money";
import type { CustomerRecord, OrganizationRecord, ServiceContext, Store } from "./types";

// Helpers shared by the quote and invoice services (FIN-02, FIN-03).

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today's date in the organization's time zone. */
export function todayIn(org: Pick<OrganizationRecord, "timezone">, now: Date): string {
  return localDateString(now, org.timezone);
}

/** The language of a customer's documents and emails: their own, else the organization's (SET-05). */
export function customerLocale(
  customer: Pick<CustomerRecord, "locale"> | null,
  org: Pick<OrganizationRecord, "settings">,
): Locale {
  return customer?.locale ?? org.settings.locale;
}

const INTL_LOCALE: Record<Locale, string> = { en: "en-US", id: "id-ID" };

/** Money as the customer reads it, e.g. "$1,250.00" or "Rp 1.250.000". */
export function moneyText(amountMinor: number, currency: Currency, locale: Locale): string {
  return formatMoney({ amountMinor, currency }, INTL_LOCALE[locale]);
}

/** A local date ("2026-11-24") as the customer reads it, e.g. "Nov 24, 2026" or "24 Nov 2026". */
export function dateText(date: string | null, locale: Locale): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** The customer-portal page of a document (POR-04). The page itself arrives with online payments. */
export function portalPath(org: Pick<OrganizationRecord, "slug">, kind: "quotes" | "invoices", id: string) {
  return `/portal/${org.slug}/${kind}/${id}`;
}

/** Loads a live customer or reports a validation error on `customer_id`. */
export async function requireCustomer(store: Store, customerId: string): Promise<CustomerRecord> {
  const customer = await store.customers.get(customerId);
  if (!customer) {
    throw new ValidationError("Unknown customer", [{ path: "customer_id", message: "Choose a customer" }]);
  }
  return customer;
}

/** Checks that a site belongs to the customer. */
export async function checkSite(store: Store, customerId: string, siteId: string | null | undefined) {
  if (!siteId) return null;
  const site = await store.sites.get(siteId);
  if (!site || site.customerId !== customerId) {
    throw new ValidationError("The site doesn't belong to this customer", [
      { path: "site_id", message: "Choose a site of this customer" },
    ]);
  }
  return site;
}

/** Checks that a contact belongs to the customer. */
export async function checkContact(store: Store, customerId: string, contactId: string | null | undefined) {
  if (!contactId) return null;
  const contact = (await store.customers.contacts(customerId)).find((c) => c.id === contactId);
  if (!contact) {
    throw new ValidationError("The contact doesn't belong to this customer", [
      { path: "contact_id", message: "Choose a contact of this customer" },
    ]);
  }
  return contact;
}

/** The contact who should receive a document: the one asked for, else the document's, else the primary one. */
export async function recipientFor(
  store: Store,
  customerId: string,
  preferred: string | null | undefined,
): Promise<{ id: string; name: string; email: string } | null> {
  const contacts = await store.customers.contacts(customerId);
  const pick = preferred
    ? contacts.find((c) => c.id === preferred)
    : (contacts.find((c) => c.isPrimary && c.email) ?? contacts.find((c) => c.email));
  if (preferred && !pick) {
    throw new ValidationError("The contact doesn't belong to this customer", [
      { path: "contact_id", message: "Choose a contact of this customer" },
    ]);
  }
  return pick?.email ? { id: pick.id, name: pick.name, email: pick.email } : null;
}

interface LineRefs {
  catalog_item_id?: string | null;
  service_type_id?: string | null;
}

/** Catalog items and service types named on lines must exist in the organization. */
export async function checkLineRefs(store: Store, lines: readonly LineRefs[]): Promise<void> {
  for (const [i, l] of lines.entries()) {
    if (l.catalog_item_id && !(await store.billing.getCatalogItem(l.catalog_item_id))) {
      throw new ValidationError("Unknown catalog item", [
        { path: `lines.${i}.catalog_item_id`, message: "Unknown catalog item" },
      ]);
    }
    if (l.service_type_id && !(await store.serviceTypes.get(l.service_type_id))) {
      throw new ValidationError("Unknown service type", [
        { path: `lines.${i}.service_type_id`, message: "Unknown service type" },
      ]);
    }
  }
}

/** A tax rate on the catalog or a service type must be one of the organization's rates (or null for the default). */
export function checkTaxRate(
  org: Pick<OrganizationRecord, "taxRates">,
  rateBps: number | null | undefined,
  path = "tax_rate_bps",
): void {
  if (rateBps === null || rateBps === undefined) return;
  if (!org.taxRates.some((r) => r.rate_bps === rateBps)) {
    throw new ValidationError("Choose one of the organization's tax rates", [
      { path, message: "Choose one of the organization's tax rates" },
    ]);
  }
}

/** Totals for lines with the document discount, plus each line's stored amounts. */
export function priceLines<L extends { quantity: number; unitPriceMinor: number; taxRateBps: number }>(
  lines: readonly L[],
  discount: { type: DiscountType | null; value: number },
): { totals: DocumentTotals; lines: (L & { position: number; netMinor: number; taxMinor: number })[] } {
  const totals = computeTotals(lines, discount);
  return {
    totals,
    lines: lines.map((l, i) => ({
      ...l,
      position: i,
      netMinor: totals.lines[i]!.netMinor,
      taxMinor: totals.lines[i]!.taxMinor,
    })),
  };
}

/** The stored totals of a document. */
export function totalsPatch(totals: DocumentTotals) {
  return {
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
  };
}

/** The value, or a not-found error naming the record. */
export function notFoundUnlessFound<T>(value: T | null, what: string): T {
  if (!value) throw new NotFoundError(what);
  return value;
}

export type BillingDeps = Pick<ServiceContext, "store" | "now" | "mailer">;
