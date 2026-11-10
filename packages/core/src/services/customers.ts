import {
  customerCreateSchema,
  customerUpdateSchema,
  equipmentCreateSchema,
  equipmentUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
  type CustomerCreateInput,
  type CustomerListQuery,
} from "@fieldops/shared";
import { normalizeEmail, normalizePhone } from "../domain/contact";
import { NotFoundError, ValidationError } from "../domain/errors";
import { assertCan, seesOnlyAssigned } from "../domain/permissions";
import { parseInput } from "./validate";
import type { ContactRecord, CustomerRecord, EquipmentRecord, ServiceContext, SiteRecord } from "./types";

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
  input: {
    emails: (string | null | undefined)[];
    phones: (string | null | undefined)[];
    excludeCustomerId?: string;
  },
) {
  assertCan(ctx.actor, "customers.create");
  const org = await ctx.store.organization.get();
  const emails = input.emails.map(normalizeEmail).filter((v): v is string => Boolean(v));
  const phones = input.phones
    .map((p) => normalizePhone(p, org.country))
    .filter((v): v is string => Boolean(v));
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
    locale: input.locale ?? null,
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
    ...(input.locale !== undefined && { locale: input.locale }),
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
  const assigned = seesOnlyAssigned(ctx.actor)
    ? await ctx.store.sites.isLinkedToMember(id, ctx.actor.memberId)
    : true;
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

// ------------------------------------------------------------------ equipment (CUS-03)

/** A unit the actor may see; access follows its site (technicians: sites of their assigned jobs). */
export async function getEquipment(ctx: ServiceContext, id: string): Promise<EquipmentRecord> {
  const unit = await ctx.store.equipment.get(id);
  if (!unit) throw new NotFoundError("Equipment");
  await getSite(ctx, unit.siteId).catch((err: unknown) => {
    throw err instanceof NotFoundError ? new NotFoundError("Equipment") : err;
  });
  return unit;
}

/** The unit, its site and customer, and its service history (jobs that worked on it, newest first). */
export async function getEquipmentDetail(ctx: ServiceContext, id: string) {
  const equipment = await getEquipment(ctx, id);
  const site = (await ctx.store.sites.get(equipment.siteId))!;
  const [customer, history] = await Promise.all([
    ctx.store.customers.get(site.customerId),
    ctx.store.equipment.history(equipment.id, {
      limit: 100,
      ...(seesOnlyAssigned(ctx.actor) ? { assignedMemberId: ctx.actor.memberId } : {}),
    }),
  ]);
  return { equipment, site, customer: customer!, history };
}

function assertWarrantyAfterInstall(install: string | null | undefined, warranty: string | null | undefined) {
  if (install && warranty && warranty < install) {
    throw new ValidationError("Warranty can't end before the install date", [
      { path: "warranty_end", message: "Must be on or after the install date" },
    ]);
  }
}

export async function createEquipment(ctx: ServiceContext, siteId: string, raw: unknown) {
  assertCan(ctx.actor, "customers.update");
  const input = parseInput(equipmentCreateSchema, raw);
  if (!(await ctx.store.sites.get(siteId))) throw new NotFoundError("Site");
  assertWarrantyAfterInstall(input.install_date, input.warranty_end);
  return ctx.store.equipment.create(siteId, {
    type: input.type,
    brand: input.brand ?? null,
    model: input.model ?? null,
    serial: input.serial ?? null,
    installDate: input.install_date ?? null,
    warrantyEnd: input.warranty_end ?? null,
    notes: input.notes ?? null,
  });
}

export async function updateEquipment(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx.actor, "customers.update");
  const input = parseInput(equipmentUpdateSchema, raw);
  const current = await ctx.store.equipment.get(id);
  if (!current) throw new NotFoundError("Equipment");
  assertWarrantyAfterInstall(
    input.install_date !== undefined ? input.install_date : current.installDate,
    input.warranty_end !== undefined ? input.warranty_end : current.warrantyEnd,
  );
  const updated = await ctx.store.equipment.update(id, {
    ...(input.type !== undefined && { type: input.type }),
    ...(input.brand !== undefined && { brand: input.brand ?? null }),
    ...(input.model !== undefined && { model: input.model ?? null }),
    ...(input.serial !== undefined && { serial: input.serial ?? null }),
    ...(input.install_date !== undefined && { installDate: input.install_date ?? null }),
    ...(input.warranty_end !== undefined && { warrantyEnd: input.warranty_end ?? null }),
    ...(input.notes !== undefined && { notes: input.notes ?? null }),
  });
  return updated!;
}

/** Soft delete: past jobs keep their link to the unit. */
export async function deleteEquipment(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "customers.update");
  if (!(await ctx.store.equipment.softDelete(id))) throw new NotFoundError("Equipment");
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
