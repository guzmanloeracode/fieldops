import type { Address } from "@fieldops/shared";
import { createMemoryStore, ctxFor, actorFor, member, uuid } from "./memory-store";
import type { ServiceContext } from "../services/types";

export const ADDRESS: Address = { line1: "1 Main St", line2: null, city: "Austin", region: "TX", postal_code: "78701", country: "US" };

/** An organization with one member of each role, two technicians, a customer with a site and equipment. */
export function world() {
  const owner = member("owner", "Olivia Owner");
  const admin = member("admin", "Adam Admin");
  const dispatcher = member("dispatcher", "Dan Dispatcher");
  const tom = member("technician", "Tom Tech");
  const rina = member("technician", "Rina Tech");
  const { store, data } = createMemoryStore({ members: [owner, admin, dispatcher, tom, rina] });
  const customerId = uuid();
  const otherCustomerId = uuid();
  const siteId = uuid();
  const otherSiteId = uuid();
  const equipmentId = uuid();
  const serviceTypeId = uuid();
  const now = new Date();
  data.customers.push(
    { id: customerId, type: "residential", name: "Cara Customer", billingAddress: null, tags: [], notes: null, createdAt: now, updatedAt: now },
    { id: otherCustomerId, type: "commercial", name: "Other Corp", billingAddress: null, tags: [], notes: null, createdAt: now, updatedAt: now },
  );
  data.contacts.push({ id: uuid(), customerId, name: "Cara", role: null, email: "cara@example.com", phone: "(512) 555-0142", isPrimary: true, emailNorm: "cara@example.com", phoneNorm: "15125550142" });
  const site = (id: string, customer: string) => ({
    id,
    customerId: customer,
    label: "Home",
    address: ADDRESS,
    latitude: null,
    longitude: null,
    accessNotes: null,
    onsiteContactName: null,
    onsiteContactPhone: null,
    createdAt: now,
    updatedAt: now,
  });
  data.sites.push(site(siteId, customerId), site(otherSiteId, otherCustomerId));
  data.equipment.push({ id: equipmentId, siteId, type: "Split AC", brand: "Carrier", model: null, serial: null, installDate: null, warrantyEnd: null });
  data.serviceTypes.push({ id: serviceTypeId, name: "AC repair", description: null, defaultDurationMin: 120, defaultPriceMinor: 18900, currency: "USD", color: null, active: true });
  const ctx = (m: typeof owner, extra: Partial<ServiceContext> = {}) => ctxFor(store, actorFor(m), extra);
  return { store, data, owner, admin, dispatcher, tom, rina, customerId, otherCustomerId, siteId, otherSiteId, equipmentId, serviceTypeId, ctx };
}

export const iso = (h: number, day = 11) => new Date(Date.UTC(2026, 10, day, h)).toISOString();
