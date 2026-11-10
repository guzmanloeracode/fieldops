import type { JobView, Store } from "@fieldops/core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

let t: TestDb;
let o: OrgData;
const customers: { id: string; name: string }[] = [];
const run = <T>(fn: (store: Store) => Promise<T>) => withStore(t.app, o.orgId, fn);

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const STATUSES = ["new", "scheduled", "en_route", "in_progress", "on_hold", "completed", "canceled"] as const;
const TITLES = ["Leaking unit", "AC not cooling", "Tune-up", "Duct cleaning", "leaking unit"];
const base = Date.UTC(2026, 10, 1, 14);

beforeAll(async () => {
  t = await freshDatabase();
  o = await createOrgWithData(t.owner, "r"); // job #1 "Job r", scheduled, assigned to tech
  for (const name of ["Alpha Plumbing", "Beta Cooling"]) {
    const id = randomUUID();
    customers.push({ id, name });
    await t.owner
      .insert(s.customer)
      .values({ id, organizationId: o.orgId, name, tags: name.startsWith("A") ? ["VIP"] : [] });
    await t.owner.insert(s.site).values({
      id: randomUUID(),
      organizationId: o.orgId,
      customerId: id,
      label: "HQ",
      line1: "1 St",
      city: "Austin",
      country: "US",
    });
  }
  const [site] = await t.owner
    .select()
    .from(s.site)
    .where((await import("drizzle-orm")).eq(s.site.customerId, customers[0]!.id));
  const jobs = [];
  const assignments = [];
  for (let i = 0; i < 40; i++) {
    const id = randomUUID();
    const scheduled = i % 4 === 0 ? null : new Date(base + (i % 9) * 3 * 3600_000); // repeating times → ties
    jobs.push({
      id,
      organizationId: o.orgId,
      number: i + 2,
      customerId: i % 3 === 0 ? customers[1]!.id : customers[0]!.id,
      siteId: site!.id,
      title: `${TITLES[i % TITLES.length]}${i % 7 === 0 ? "" : ` ${i}`}`,
      priority: PRIORITIES[i % 4]!,
      status: STATUSES[i % 7]!,
      scheduledStart: scheduled,
      scheduledEnd: scheduled ? new Date(scheduled.getTime() + 3600_000) : null,
      createdAt: new Date(base - (40 - i) * 3600_000 - (i % 5 === 0 ? 0 : 1)),
    });
    if (i % 2 === 0)
      assignments.push({
        organizationId: o.orgId,
        jobId: id,
        memberId: i % 4 === 0 ? o.members.tech : o.members.tech2,
        isLead: true,
      });
  }
  // A job late in the evening in Chicago that is already the next day in UTC.
  jobs.push({
    id: randomUUID(),
    organizationId: o.orgId,
    number: 42,
    customerId: customers[0]!.id,
    siteId: site!.id,
    title: "Late evening visit",
    priority: "normal",
    status: "scheduled",
    scheduledStart: new Date("2026-11-12T05:30:00Z"), // Nov 11, 23:30 CST
    scheduledEnd: new Date("2026-11-12T06:30:00Z"),
    createdAt: new Date(base),
  });
  await t.owner.insert(s.job).values(jobs);
  await t.owner.insert(s.jobAssignment).values(assignments);
  await t.owner
    .insert(s.orgCounter)
    .values({ organizationId: o.orgId, name: "job", value: 42 })
    .onConflictDoUpdate({
      target: [s.orgCounter.organizationId, s.orgCounter.name],
      set: { value: 42 },
    });
});
afterAll(async () => t?.close());

async function walk(sort: string, limit: number, extra: Record<string, unknown> = {}) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await run((st) => st.jobs.list({ sort, limit, ...(cursor ? { cursor } : {}), ...extra }));
    ids.push(...page.rows.map((r) => r.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return ids;
}

describe("job list", () => {
  const SORTS = [
    "-created_at",
    "created_at",
    "number",
    "-number",
    "scheduled_start",
    "-scheduled_start",
    "priority,-scheduled_start",
    "-priority,number",
    "status,title",
    "-status,-created_at",
    "title",
    "-title,scheduled_start",
  ];
  for (const sort of SORTS) {
    it(`walks every page without gaps or duplicates (sort=${sort})`, async () => {
      const all = (await run((st) => st.jobs.list({ sort, limit: 100 }))).rows.map((r) => r.id);
      expect(all).toHaveLength(42);
      for (const limit of [5, 7]) {
        const walked = await walk(sort, limit);
        expect(new Set(walked).size).toBe(walked.length);
        expect(walked).toEqual(all);
      }
    });
  }

  it("orders as asked, with unscheduled jobs last in both directions", async () => {
    const asc = (await run((st) => st.jobs.list({ sort: "scheduled_start", limit: 100 }))).rows;
    const desc = (await run((st) => st.jobs.list({ sort: "-scheduled_start", limit: 100 }))).rows;
    const times = (rows: JobView[]) => rows.map((r) => r.scheduledStart?.getTime() ?? null);
    const firstNullAsc = times(asc).indexOf(null);
    expect(
      times(asc)
        .slice(firstNullAsc)
        .every((x) => x === null),
    ).toBe(true);
    const firstNullDesc = times(desc).indexOf(null);
    expect(
      times(desc)
        .slice(firstNullDesc)
        .every((x) => x === null),
    ).toBe(true);
    const ascTimes = times(asc).filter((x): x is number => x !== null);
    expect(ascTimes).toEqual([...ascTimes].sort((a, b) => a - b));
    const pri = (await run((st) => st.jobs.list({ sort: "-priority", limit: 100 }))).rows.map(
      (r) => r.priority,
    );
    expect(pri.indexOf("urgent")).toBe(0);
    expect(pri.lastIndexOf("low")).toBe(pri.length - 1);
    const numbers = (await run((st) => st.jobs.list({ sort: "number", limit: 3 }))).rows.map((r) => r.number);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("filters by text, number, status, priority, customer and technician", async () => {
    const titles = (await run((st) => st.jobs.list({ sort: "number", limit: 100, q: "leaking" }))).rows.map(
      (r) => r.title.toLowerCase(),
    );
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((x) => x.includes("leaking"))).toBe(true);
    expect(
      (await run((st) => st.jobs.list({ sort: "number", limit: 100, q: "beta cool" }))).rows.every(
        (r) => r.customer.name === "Beta Cooling",
      ),
    ).toBe(true);
    expect(
      (await run((st) => st.jobs.list({ sort: "number", limit: 100, q: "JOB-000017" }))).rows.map(
        (r) => r.number,
      ),
    ).toEqual([17]);
    expect((await run((st) => st.jobs.list({ sort: "number", limit: 100, q: "100%_" }))).rows).toEqual([]);
    const byStatus = (
      await run((st) => st.jobs.list({ sort: "number", limit: 100, status: ["on_hold", "canceled"] }))
    ).rows;
    expect(byStatus.length).toBeGreaterThan(0);
    expect(byStatus.every((r) => r.status === "on_hold" || r.status === "canceled")).toBe(true);
    const urgent = (await run((st) => st.jobs.list({ sort: "number", limit: 100, priority: ["urgent"] })))
      .rows;
    expect(urgent.every((r) => r.priority === "urgent")).toBe(true);
    const beta = (await run((st) => st.jobs.list({ sort: "number", limit: 100, customer: customers[1]!.id })))
      .rows;
    expect(beta.length).toBe(14);
    const tech = (await run((st) => st.jobs.list({ sort: "number", limit: 100, technician: o.members.tech })))
      .rows;
    expect(tech.every((r) => r.assignees.some((a) => a.memberId === o.members.tech))).toBe(true);
    expect(tech).toHaveLength(11);
    const st1 = (
      await run((st) => st.jobs.list({ sort: "number", limit: 100, service_type: o.ids.serviceType }))
    ).rows;
    expect(st1.map((r) => r.number)).toEqual([1]);
  });

  it("filters dates in the organization's time zone", async () => {
    const nov11 = (
      await run((st) => st.jobs.list({ sort: "number", limit: 100, from: "2026-11-11", to: "2026-11-11" }))
    ).rows.map((r) => r.title);
    expect(nov11).toContain("Late evening visit");
    expect(nov11).toContain("Job r"); // 15:00 UTC = 09:00 CST on Nov 11
    const nov12 = (
      await run((st) => st.jobs.list({ sort: "number", limit: 100, from: "2026-11-12", to: "2026-11-12" }))
    ).rows;
    expect(nov12.map((r) => r.title)).not.toContain("Late evening visit");
    // Unscheduled jobs fall back to their creation date.
    const oct = (await run((st) => st.jobs.list({ sort: "number", limit: 100, to: "2026-10-31" }))).rows;
    expect(oct.length).toBeGreaterThan(0);
    expect(oct.every((r) => (r.scheduledStart ?? r.createdAt) < new Date("2026-11-01T05:00:00Z"))).toBe(true);
  });

  it("restricts technicians to their own jobs, whatever they filter", async () => {
    const own = (
      await run((st) => st.jobs.list({ sort: "number", limit: 100, assignedMemberId: o.members.tech }))
    ).rows;
    expect(own.length).toBe(11);
    expect(own.every((r) => r.assignees.some((a) => a.memberId === o.members.tech))).toBe(true);
    expect(
      (
        await run((st) =>
          st.jobs.list({
            sort: "number",
            limit: 100,
            assignedMemberId: o.members.tech,
            technician: o.members.tech2,
          }),
        )
      ).rows,
    ).toEqual([]);
  });

  it("returns totals for offset pagination", async () => {
    const p1 = await run((st) => st.jobs.list({ sort: "number", limit: 10, page: 1 }));
    const p5 = await run((st) => st.jobs.list({ sort: "number", limit: 10, page: 5 }));
    expect(p1.total).toBe(42);
    expect(p1.nextCursor).toBeNull();
    expect(p5.rows.map((r) => r.number)).toEqual([41, 42]);
    const filtered = await run((st) =>
      st.jobs.list({ sort: "number", limit: 10, page: 1, customer: customers[1]!.id }),
    );
    expect(filtered.total).toBe(14);
  });

  it("rejects a cursor from another sort", async () => {
    const first = await run((st) => st.jobs.list({ sort: "number", limit: 5 }));
    await expect(
      run((st) => st.jobs.list({ sort: "-number", limit: 5, cursor: first.nextCursor! })),
    ).rejects.toThrow(/Invalid cursor/);
  });
});

describe("job repository", () => {
  it("hands out unique numbers to parallel transactions", async () => {
    const numbers = await Promise.all(Array.from({ length: 12 }, () => run((st) => st.jobs.nextNumber())));
    expect(new Set(numbers).size).toBe(12);
    expect(Math.min(...numbers)).toBe(43);
    expect(Math.max(...numbers)).toBe(54);
  });

  it("finds overlapping open visits for a technician", async () => {
    const window = (a: string, b: string) => [new Date(a), new Date(b)] as const;
    const [s1, e1] = window("2026-11-11T16:00:00Z", "2026-11-11T18:00:00Z");
    expect(await run((st) => st.jobs.overlapping(o.members.tech, s1, e1, randomUUID()))).toEqual([
      { id: o.ids.job, number: 1 },
    ]);
    const [s2, e2] = window("2026-11-11T17:00:00Z", "2026-11-11T18:00:00Z");
    expect(await run((st) => st.jobs.overlapping(o.members.tech, s2, e2, randomUUID()))).toEqual([]);
    expect(await run((st) => st.jobs.overlapping(o.members.tech, s1, e1, o.ids.job))).toEqual([]);
    expect(await run((st) => st.jobs.overlapping(o.members.tech2, s1, e1, randomUUID()))).toEqual([]);
  });

  it("checks the version on update and bumps it", async () => {
    const before = await run((st) => st.jobs.get(o.ids.job));
    const ok = await run((st) => st.jobs.update(o.ids.job, { title: "Job r v2" }, before!.version));
    expect(ok?.version).toBe(before!.version + 1);
    expect(await run((st) => st.jobs.update(o.ids.job, { title: "stale" }, before!.version))).toBeNull();
    const after = await run((st) => st.jobs.getByNumber(1));
    expect(after?.title).toBe("Job r v2");
  });

  it("returns a full view with customer, site, service type and assignees", async () => {
    const v = await run((st) => st.jobs.get(o.ids.job));
    expect(v).toMatchObject({
      number: 1,
      customer: { id: o.ids.customer, name: "Customer r" },
      site: { id: o.ids.site, label: "Home", address: { line1: "1 Main", city: "Austin", country: "US" } },
      serviceType: { id: o.ids.serviceType, name: "AC repair" },
      assignees: [{ memberId: o.members.tech, userId: o.users.tech, name: "r tech", isLead: true }],
    });
    expect(await run((st) => st.jobs.missingRequiredChecklistItems(o.ids.job))).toEqual(["Photo"]);
  });

  it("replaces assignments, records events with actor names and soft-deletes", async () => {
    await run(async (st) => {
      await st.jobs.setAssignments(o.ids.job, [
        { memberId: o.members.tech2, isLead: true },
        { memberId: o.members.tech, isLead: false },
      ]);
      await st.jobs.addEvent({
        jobId: o.ids.job,
        type: "assigned",
        fromStatus: null,
        toStatus: null,
        actorUserId: o.users.dispatcher,
        payload: { a: 1 },
      });
    });
    const v = await run((st) => st.jobs.get(o.ids.job));
    expect(v!.assignees.map((a) => [a.memberId, a.isLead])).toEqual([
      [o.members.tech2, true],
      [o.members.tech, false],
    ]);
    const events = await run((st) => st.jobs.events(o.ids.job));
    expect(events[0]).toMatchObject({
      type: "assigned",
      actor: { id: o.users.dispatcher, name: "r dispatcher" },
      payload: { a: 1 },
    });
    await run(async (st) => {
      await st.jobs.setAssignments(o.ids.job, [{ memberId: o.members.tech, isLead: true }]);
    });
    const created = await run((st) =>
      st.jobs.create({
        number: 999,
        customerId: o.ids.customer,
        siteId: o.ids.site,
        equipmentId: null,
        serviceTypeId: null,
        title: "Temp",
        description: null,
        priority: "low",
        source: "api",
        preferredStart: null,
        preferredEnd: null,
        estimatedDurationMin: 30,
        aiDrafted: false,
        needsReview: false,
        createdBy: o.users.owner,
      }),
    );
    expect(created).toMatchObject({ status: "new", version: 1, number: 999 });
    expect(await run((st) => st.jobs.softDelete(created.id))).toBe(true);
    expect(await run((st) => st.jobs.get(created.id))).toBeNull();
    expect(await run((st) => st.jobs.softDelete(created.id))).toBe(false);
  });
});

describe("customer repository", () => {
  it("searches by name, contact email and phone digits", async () => {
    const names = async (q: string) =>
      (await run((st) => st.customers.list({ sort: "name", limit: 50, q }))).rows.map((c) => c.name);
    expect(await names("alpha")).toEqual(["Alpha Plumbing"]);
    expect(await names("c-r@example")).toEqual(["Customer r"]);
    expect(await names("555-0100")).toEqual(["Customer r"]);
    expect(await names("nothing like this")).toEqual([]);
  });

  it("filters by tag and type, sorts and paginates", async () => {
    expect(
      (await run((st) => st.customers.list({ sort: "name", limit: 50, tag: "VIP" }))).rows.map((c) => c.name),
    ).toEqual(["Alpha Plumbing"]);
    expect(
      (await run((st) => st.customers.list({ sort: "name", limit: 50, type: "commercial" }))).rows,
    ).toEqual([]);
    const all = (await run((st) => st.customers.list({ sort: "-name", limit: 50 }))).rows.map((c) => c.name);
    expect(all).toEqual(["Customer r", "Beta Cooling", "Alpha Plumbing"]);
    const p1 = await run((st) => st.customers.list({ sort: "name", limit: 2 }));
    const p2 = await run((st) => st.customers.list({ sort: "name", limit: 2, cursor: p1.nextCursor! }));
    expect([...p1.rows, ...p2.rows].map((c) => c.name)).toEqual([
      "Alpha Plumbing",
      "Beta Cooling",
      "Customer r",
    ]);
    expect(p2.nextCursor).toBeNull();
    const c1 = await run((st) => st.customers.list({ sort: "-created_at", limit: 1 }));
    const c2 = await run((st) =>
      st.customers.list({ sort: "-created_at", limit: 5, cursor: c1.nextCursor! }),
    );
    expect(new Set([...c1.rows, ...c2.rows].map((c) => c.id)).size).toBe(3);
    const paged = await run((st) => st.customers.list({ sort: "name", limit: 2, page: 2 }));
    expect(paged).toMatchObject({ total: 3, nextCursor: null });
    expect(paged.rows.map((c) => c.name)).toEqual(["Customer r"]);
  });

  it("adds list columns: primary contact, site and open job counts, last job", async () => {
    const row = (await run((st) => st.customers.list({ sort: "name", limit: 50, q: "Customer r" }))).rows[0]!;
    expect(row).toMatchObject({
      primaryContact: { name: "Contact", email: "c-r@example.com" },
      siteCount: 1,
      openJobCount: 1,
    });
    expect(row.lastJobAt).toBeInstanceOf(Date);
    const stats = await run((st) => st.customers.stats(customers[1]!.id));
    expect(stats.jobCount).toBe(14);
  });

  it("restricts technicians to customers of their jobs", async () => {
    const names = (
      await run((st) => st.customers.list({ sort: "name", limit: 50, assignedMemberId: o.members.tech2 }))
    ).rows.map((c) => c.name);
    // tech2 works on Alpha and Beta jobs but never on Customer r's job.
    expect(names).toEqual(["Alpha Plumbing", "Beta Cooling"]);
    expect(await run((st) => st.customers.isLinkedToMember(customers[0]!.id, o.members.tech2))).toBe(true);
    expect(await run((st) => st.customers.isLinkedToMember(o.ids.customer, o.members.tech2))).toBe(false);
  });

  it("finds duplicates by normalized email or phone, excluding a customer", async () => {
    await run(async (st) => {
      const c = await st.customers.create({
        type: "residential",
        name: "Dup Test",
        billingAddress: null,
        tags: [],
        notes: null,
      });
      await st.customers.addContact(c.id, {
        name: "D",
        role: null,
        email: "dup@example.com",
        phone: "0812-3456-789",
        isPrimary: true,
        emailNorm: "dup@example.com",
        phoneNorm: "628123456789",
      });
    });
    const byEmail = await run((st) =>
      st.customers.findDuplicates({ emails: ["dup@example.com"], phones: [] }),
    );
    expect(byEmail).toEqual([{ id: expect.any(String), name: "Dup Test", matchedOn: "email" }]);
    const byPhone = await run((st) =>
      st.customers.findDuplicates({ emails: ["other@example.com"], phones: ["628123456789"] }),
    );
    expect(byPhone).toEqual([{ id: byEmail[0]!.id, name: "Dup Test", matchedOn: "phone" }]);
    expect(
      await run((st) =>
        st.customers.findDuplicates({
          emails: ["dup@example.com"],
          phones: [],
          excludeCustomerId: byEmail[0]!.id,
        }),
      ),
    ).toEqual([]);
    expect(await run((st) => st.customers.findDuplicates({ emails: [], phones: [] }))).toEqual([]);
    await run((st) => st.customers.softDelete(byEmail[0]!.id));
    expect(
      await run((st) => st.customers.findDuplicates({ emails: ["dup@example.com"], phones: [] })),
    ).toEqual([]);
  });

  it("updates and soft-deletes", async () => {
    const c = await run((st) =>
      st.customers.create({
        type: "commercial",
        name: "Temp Co",
        billingAddress: null,
        tags: ["x"],
        notes: null,
      }),
    );
    const u = await run((st) => st.customers.update(c.id, { name: "Temp Co 2", tags: [] }));
    expect(u).toMatchObject({ name: "Temp Co 2", tags: [], type: "commercial" });
    expect(await run((st) => st.customers.softDelete(c.id))).toBe(true);
    expect(await run((st) => st.customers.get(c.id))).toBeNull();
  });
});

describe("other repositories", () => {
  it("sites, equipment, notes, attachments, members, service types and organization", async () => {
    await run(async (st) => {
      const site = await st.sites.create(o.ids.customer, {
        label: "Cabin",
        address: {
          line1: "2 Lake Rd",
          line2: null,
          city: "Austin",
          region: "TX",
          postal_code: "78701",
          country: "US",
        },
        latitude: 30.1,
        longitude: -97.7,
        accessNotes: null,
        onsiteContactName: null,
        onsiteContactPhone: null,
      });
      expect(site.address.postal_code).toBe("78701");
      const moved = await st.sites.update(site.id, {
        address: {
          line1: "3 Lake Rd",
          line2: null,
          city: "Lakeway",
          region: null,
          postal_code: null,
          country: "US",
        },
      });
      expect(moved?.address).toMatchObject({ line1: "3 Lake Rd", city: "Lakeway", region: null });
      expect((await st.sites.listByCustomer(o.ids.customer)).map((x) => x.label)).toEqual(["Home", "Cabin"]);
      expect(await st.sites.isLinkedToMember(o.ids.site, o.members.tech)).toBe(true);
      expect((await st.equipment.listBySite(o.ids.site)).map((e) => e.type)).toEqual(["Split AC"]);

      const note = await st.notes.create(o.ids.job, {
        body: "Customer-facing",
        visibility: "customer",
        authorUserId: o.users.tech,
      });
      expect(note.author).toEqual({ id: o.users.tech, name: "r tech" });
      expect((await st.notes.list(o.ids.job, { visibility: "customer" })).map((n) => n.id)).toEqual([
        note.id,
      ]);

      const att = await st.attachments.create({
        jobId: o.ids.job,
        kind: "photo",
        storageKey: "k",
        thumbKey: null,
        fileName: "a.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 5,
        tag: "after",
        status: "pending",
        uploadedBy: o.users.tech,
      });
      expect((await st.attachments.markReady(att.id))?.status).toBe("ready");
      expect(await st.attachments.remove(att.id)).toBe(true);

      const members = await st.members.list();
      expect(members.map((m) => m.role)).toEqual(["owner", "dispatcher", "technician", "technician"]);
      expect(await st.members.countByRole("technician")).toBe(2);
      await st.members.updateRole(o.members.tech2, "dispatcher");
      expect((await st.members.get(o.members.tech2))?.role).toBe("dispatcher");

      const type = await st.serviceTypes.create({
        name: "Duct cleaning",
        description: null,
        defaultDurationMin: 180,
        defaultPriceMinor: 34900,
        currency: "USD",
        color: null,
        active: false,
      });
      expect((await st.serviceTypes.list()).map((x) => x.name)).toEqual(["AC repair"]);
      expect((await st.serviceTypes.list({ includeInactive: true })).map((x) => x.name)).toEqual([
        "AC repair",
        "Duct cleaning",
      ]);
      expect((await st.serviceTypes.update(type.id, { active: true }))?.active).toBe(true);

      const org = await st.organization.update({
        brandColor: "#123456",
        taxRates: [{ name: "Tax", rate_bps: 825, default: true }],
      });
      expect(org).toMatchObject({
        brandColor: "#123456",
        timezone: "America/Chicago",
        taxRates: [{ name: "Tax", rate_bps: 825, default: true }],
      });
    });
  });
});
