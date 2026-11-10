import {
  customerCreateSchema,
  customerUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
  type CustomerCreateInput,
  type CustomerListQuery,
} from "@fieldops/shared";
import { normalizeEmail, normalizePhone } from "../domain/contact";
import { NotFoundError } from "../domain/errors";
import { assertCan, seesOnlyAssigned } from "../domain/permissions";
import { parseInput } from "./validate";
import type { ContactRecord, CustomerRecord, ServiceContext, SiteRecord } from "./types";

export async function listCustomers(ctx: ServiceContext, query: CustomerListQuery) {
  assertCan(ctx.actor, "customers.view", { assigned: true });
  return ctx.store.customers.list({
    ...query,
    ...(seesOnlyAssigned(ctx.actor) ? { assignedMemberId: ctx.actor.memberId } : {}),
  });
}

/** Loads a customer the actor may see. Technicians only see customers of their assigned jobs. */
export async function getCustomer(ctx: ServiceContext, id: string): Promise<CustomerRecord> {
  const customer = await ctx.store.customers.get(id);
  if (!customer) throw new NotFoundError("Customer");
  const assigned = seesOnlyAssigned(ctx.actor)
    ? await ctx.store.customers.isLinkedToMember(id, ctx.actor.memberId)
    : true;
  if (!assigned) throw new NotFoundError("Customer");
  assertCan(ctx.actor, "customers.view", { assigned });
  return customer;
}

export async function getCustomerDetail(ctx: ServiceContext, id: string) {
  const customer = await getCustomer(ctx, id);
  const [contacts, sites, stats] = await Promise.all([
    ctx.store.customers.contacts(id),
    ctx.store.sites.listByCustomer(id),
    ctx.store.customers.stats(id),
  ]);
  return { customer, contacts, sites, stats };
}

export async function findDuplicateCustomers(
  ctx: ServiceContext,
  input: { emails: (string | null | undefined)[]; phones: (string | null | undefined)[]; excludeCustomerId?: string },
) {
  assertCan(ctx.actor, "customers.create");
  const org = await ctx.store.organization.get();
  const emails = input.emails.map(normalizeEmail).filter((v): v is string => Boolean(v));
  const phones = input.phones.map((p) => normalizePhone(p, org.country)).filter((v): v is string => Boolean(v));
  if (emails.length === 0 && phones.length === 0) return [];
  return ctx.store.customers.findDuplicates({ emails, phones, excludeCustomerId: input.excludeCustomerId });
}

export async function createCustomer(ctx: ServiceContext, raw: CustomerCreateInput | unknown) {
  assertCan(ctx.actor, "customers.create");
  const input = parseInput(customerCreateSchema, raw);
  const duplicates = await findDuplicateCustomers(ctx, {
    emails: input.contacts.map((c) => c.email),
    phones: input.contacts.map((c) => c.phone),
  });
  const org = await ctx.store.organization.get();
  const customer = await ctx.store.customers.create({
    type: input.type,
    name: input.name,
    billingAddress: input.billing_address ?? null,
    tags: dedupe(input.tags),
    notes: input.notes ?? null,
  });
  const contacts: ContactRecord[] = [];
  const hasPrimary = input.contacts.some((c) => c.is_primary);
  for (const [i, c] of input.contacts.entries()) {
    contacts.push(
      await ctx.store.customers.addContact(customer.id, {
        name: c.name,
        role: c.role ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        isPrimary: c.is_primary || (!hasPrimary && i === 0),
        emailNorm: normalizeEmail(c.email),
        phoneNorm: normalizePhone(c.phone, org.country),
      }),
    );
  }
  return { customer, contacts, duplicates };
}

export async function updateCustomer(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx.actor, "customers.update");
  const input = parseInput(customerUpdateSchema, raw);
  const updated = await ctx.store.customers.update(id, {
    ...(input.type !== undefined && { type: input.type }),
    ...(input.name !== undefined && { name: input.name }),
    ...(input.billing_address !== undefined && { billingAddress: input.billing_address }),
    ...(input.tags !== undefined && { tags: dedupe(input.tags) }),
    ...(input.notes !== undefined && { notes: input.notes }),
  });
  if (!updated) throw new NotFoundError("Customer");
  return updated;
}

export async function deleteCustomer(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "customers.delete");
  if (!(await ctx.store.customers.softDelete(id))) throw new NotFoundError("Customer");
}

export async function listSites(ctx: ServiceContext, customerId: string): Promise<SiteRecord[]> {
  await getCustomer(ctx, customerId);
  return ctx.store.sites.listByCustomer(customerId);
}

export async function createSite(ctx: ServiceContext, customerId: string, raw: unknown) {
  assertCan(ctx.actor, "customers.update");
  const input = parseInput(siteCreateSchema, raw);
  if (!(await ctx.store.customers.get(customerId))) throw new NotFoundError("Customer");
  return ctx.store.sites.create(customerId, {
    label: input.label,
    address: input.address,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accessNotes: input.access_notes ?? null,
    onsiteContactName: input.onsite_contact_name ?? null,
    onsiteContactPhone: input.onsite_contact_phone ?? null,
  });
}

export async function getSite(ctx: ServiceContext, id: string): Promise<SiteRecord> {
  const site = await ctx.store.sites.get(id);
  if (!site) throw new NotFoundError("Site");
  const assigned = seesOnlyAssigned(ctx.actor) ? await ctx.store.sites.isLinkedToMember(id, ctx.actor.memberId) : true;
  if (!assigned) throw new NotFoundError("Site");
  assertCan(ctx.actor, "customers.view", { assigned });
  return site;
}

/** Equipment at a site the actor may see (technicians: sites of their assigned jobs). */
export async function listSiteEquipment(ctx: ServiceContext, siteId: string) {
  const site = await getSite(ctx, siteId);
  return ctx.store.equipment.listBySite(site.id);
}

export async function updateSite(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx.actor, "customers.update");
  const input = parseInput(siteUpdateSchema, raw);
  const updated = await ctx.store.sites.update(id, {
    ...(input.label !== undefined && { label: input.label }),
    ...(input.address !== undefined && { address: input.address }),
    ...(input.latitude !== undefined && { latitude: input.latitude }),
    ...(input.longitude !== undefined && { longitude: input.longitude }),
    ...(input.access_notes !== undefined && { accessNotes: input.access_notes }),
    ...(input.onsite_contact_name !== undefined && { onsiteContactName: input.onsite_contact_name }),
    ...(input.onsite_contact_phone !== undefined && { onsiteContactPhone: input.onsite_contact_phone }),
  });
  if (!updated) throw new NotFoundError("Site");
  return updated;
}

function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
