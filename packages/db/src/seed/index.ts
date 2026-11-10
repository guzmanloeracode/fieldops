import { Faker, base, en, en_US, id_ID } from "@faker-js/faker";
import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { quiet, type Database, type Tx } from "../client";
import * as s from "../schema";
import { ORGS, ROOMS, ROOMS_ID, type OrgSpec } from "./data";
import { seedDispatch } from "./dispatch";
import { seedExpenses } from "./expenses";
import { seedFieldwork } from "./fieldwork";
import { seedInsights } from "./insights";
import { seedAi } from "./ai";
import { seedAudit } from "./audit";
import { seedNotifications } from "./notifications";
import { seedPortal } from "./portal";
import { seedSla } from "./sla";
import type { SeedContext } from "./context";
import { DAY, insertBatches, localDate, zoned } from "./time";
export { DEMO_LOGINS, ORGS, type DemoOrg, type DemoRole } from "./data";
export { DEMO_PORTAL_LOGINS } from "./portal";

/**
 * Deterministic demo seed (DEM-02, DEM-03). The same seed and reset time always produce the same data, and
 * every date is relative to the reset time, so the demo always shows a past history, a busy today and a
 * scheduled week ahead.
 */
export interface SeedOptions {
  now?: Date;
  password: string;
  /** Number of past days to generate (default 180). */
  days?: number;
}

export interface SeedResult {
  organizations: { id: string; slug: string; name: string; jobs: number; customers: number }[];
  demoUsers: { email: string; role: string; org: string }[];
}

const SEED = 20261110;

/** Removes all data. Used by the nightly demo reset before seeding again (DEM-04). */
export async function wipeAll(db: Database) {
  await db.execute(sql`truncate table
    "audit_log", "notification", "notification_preference", "sla_alert", "ai_interaction", "portal_token",
    "portal_session", "rate_limit", "sla_policy",
    "email_outbox", "idempotency_key", "saved_view", "expense_request", "time_entry", "time_off",
    "attachment", "note", "job_event", "checklist_item", "job_assignment", "job",
    "equipment", "site", "contact", "customer", "service_type", "org_counter",
    "invitation", "member", "session", "account", "verification", "organization", "user" cascade`);
}

export async function seedDemo(db: Database, opts: SeedOptions): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const passwordHash = await hashPassword(opts.password);
  const result: SeedResult = { organizations: [], demoUsers: [] };
  for (const [i, spec] of ORGS.entries()) {
    await db.transaction(async (tx) => {
      // Bulk inserts aren't user actions: no audit rows, no live events.
      await quiet(tx);
      const r = await seedOrg(tx, spec, { now, passwordHash, seed: SEED + i, days: opts.days ?? 180 });
      result.organizations.push(r.org);
      result.demoUsers.push(...r.demoUsers);
    });
  }
  return result;
}

interface Slot {
  start: Date;
  end: Date;
}

async function seedOrg(
  tx: Tx,
  spec: OrgSpec,
  ctx: { now: Date; passwordHash: string; seed: number; days: number },
) {
  const f = new Faker({ locale: spec.fakerLocale === "en_US" ? [en_US, en, base] : [id_ID, en, base] });
  f.seed(ctx.seed);
  const pick = <T>(arr: readonly T[]): T => f.helpers.arrayElement(arr);
  const chance = (p: number) => f.number.float({ min: 0, max: 1 }) < p;
  const tz = spec.timezone;
  const minor = (major: number) => major * 100;

  // ------------------------------------------------------------ organization and team
  const orgId = uuidv7();
  await tx.insert(s.organization).values({
    id: orgId,
    name: spec.name,
    slug: spec.slug,
    timezone: tz,
    currency: spec.currency,
    country: spec.country,
    brandColor: spec.brandColor,
    address: {
      line1: spec.key === "acme-air" ? "1200 Example Ave, Suite 300" : "Jl. Contoh Raya No. 12",
      line2: null,
      city: spec.city,
      region: spec.region,
      postal_code: spec.key === "acme-air" ? "78701" : "12950",
      country: spec.country,
    },
    businessHours: [1, 2, 3, 4, 5]
      .map((day) => ({ day, open: "08:00", close: "17:00" }))
      .concat(spec.key === "acme-teknik" ? [{ day: 6, open: "08:00", close: "13:00" }] : []),
    taxRates: spec.taxRates,
    isDemo: true,
    plan: "pro",
    createdAt: new Date(ctx.now.getTime() - 400 * DAY),
  });

  const members: { id: string; userId: string; name: string; role: string; skills: string[] }[] = [];
  const demoUsers: SeedResult["demoUsers"] = [];
  for (const t of spec.team) {
    const userId = uuidv7();
    const memberId = uuidv7();
    const email = `${t.name.toLowerCase().split(" ")[0]}@${spec.emailDomain}`;
    await tx.insert(s.user).values({
      id: userId,
      name: t.name,
      email,
      emailVerified: true,
      locale: spec.locale,
      isDemo: true,
      createdAt: new Date(ctx.now.getTime() - 380 * DAY),
    });
    await tx.insert(s.account).values({
      id: uuidv7(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: ctx.passwordHash,
    });
    await tx.insert(s.member).values({
      id: memberId,
      organizationId: orgId,
      userId,
      role: t.role,
      skills: t.skills ?? [],
      phone:
        spec.key === "acme-air"
          ? `(512) 555-01${String(members.length + 10).padStart(2, "0")}`
          : `0812-5550-${String(members.length + 10).padStart(4, "0")}`,
    });
    members.push({ id: memberId, userId, name: t.name, role: t.role, skills: t.skills ?? [] });
    if (t.demo) demoUsers.push({ email, role: t.role, org: spec.slug });
  }
  const technicians = members.filter((m) => m.role === "technician");
  const dispatchers = members.filter((m) => m.role === "dispatcher" || m.role === "owner");

  // ------------------------------------------------------------ service types
  const serviceTypes = spec.serviceTypes.map((st) => ({
    id: uuidv7(),
    organizationId: orgId,
    name: st.name,
    defaultDurationMin: st.duration,
    defaultPriceMinor: minor(st.priceMajor),
    currency: spec.currency,
    color: st.color,
    requiredSkills: requiredSkills(st.name),
    spec: st,
  }));
  await tx.insert(s.serviceType).values(serviceTypes.map(({ spec: _spec, ...row }) => row));

  // ------------------------------------------------------------ customers, contacts, sites, equipment
  const customers: { id: string; name: string; commercial: boolean; createdAt: Date }[] = [];
  const contacts: (typeof s.contact.$inferInsert)[] = [];
  const sites: (typeof s.site.$inferInsert & { id: string; customerId: string })[] = [];
  const phone = (n: number) =>
    spec.key === "acme-air"
      ? `(512) 555-${String(1000 + (n % 9000)).padStart(4, "0")}`
      : `0812-5550-${String(1000 + (n % 9000)).padStart(4, "0")}`;
  const phoneNorm = (p: string) =>
    spec.key === "acme-air" ? "1" + p.replace(/\D/g, "") : "62" + p.replace(/\D/g, "").slice(1);
  const jitter = () => f.number.float({ min: -0.12, max: 0.12 });

  for (let i = 0; i < spec.customers; i++) {
    const commercial = chance(0.28);
    const person = { first: f.person.firstName(), last: f.person.lastName() };
    const name = commercial ? f.company.name() : `${person.first} ${person.last}`;
    const id = uuidv7();
    const createdAt = new Date(ctx.now.getTime() - f.number.int({ min: 30, max: 380 }) * DAY);
    customers.push({ id, name, commercial, createdAt });
    const contactCount = commercial ? f.number.int({ min: 1, max: 3 }) : chance(0.2) ? 2 : 1;
    for (let c = 0; c < contactCount; c++) {
      const cf = c === 0 && !commercial ? person : { first: f.person.firstName(), last: f.person.lastName() };
      const email =
        `${cf.first}.${cf.last}${i}`
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^a-z0-9.]/g, "") + "@example.com";
      const p = phone(i * 3 + c);
      contacts.push({
        organizationId: orgId,
        customerId: id,
        name: `${cf.first} ${cf.last}`,
        role: commercial
          ? pick(
              spec.key === "acme-air"
                ? ["Office manager", "Facilities", "Owner", "Accounts"]
                : ["Manajer kantor", "Bagian umum", "Pemilik"],
            )
          : c === 0
            ? null
            : spec.key === "acme-air"
              ? "Spouse"
              : "Keluarga",
        email,
        emailNorm: email,
        phone: p,
        phoneNorm: phoneNorm(p),
        isPrimary: c === 0,
        createdAt,
      });
    }
  }
  // Every customer gets one site; the extra sites go to commercial customers first.
  const extraSites = spec.sites - spec.customers;
  const commercialCustomers = customers.filter((c) => c.commercial);
  const siteOwners = [
    ...customers,
    ...Array.from({ length: extraSites }, (_, k) => commercialCustomers[k % commercialCustomers.length]!),
  ];
  for (const [k, owner] of siteOwners.entries()) {
    const first = !sites.some((x) => x.customerId === owner.id);
    sites.push({
      id: uuidv7(),
      organizationId: orgId,
      customerId: owner.id,
      label: first
        ? owner.commercial
          ? spec.key === "acme-air"
            ? "Main office"
            : "Kantor pusat"
          : spec.key === "acme-air"
            ? "Home"
            : "Rumah"
        : `${spec.key === "acme-air" ? "Branch" : "Cabang"} ${(k % 7) + 2}`,
      line1:
        spec.key === "acme-air"
          ? `${f.number.int({ min: 100, max: 9999 })} ${f.location.street()}`
          : `Jl. ${f.location.street()} No. ${f.number.int({ min: 1, max: 200 })}`,
      line2:
        owner.commercial && chance(0.4)
          ? spec.key === "acme-air"
            ? `Suite ${f.number.int({ min: 100, max: 900 })}`
            : `Lantai ${f.number.int({ min: 1, max: 12 })}`
          : null,
      city: spec.city,
      region: spec.region,
      postalCode:
        spec.key === "acme-air"
          ? `787${f.number.int({ min: 1, max: 59 }).toString().padStart(2, "0")}`
          : `1${f.number.int({ min: 1000, max: 4999 })}0`,
      country: spec.country,
      latitude: Number((spec.center[0] + jitter()).toFixed(5)),
      longitude: Number((spec.center[1] + jitter()).toFixed(5)),
      accessNotes: chance(0.3)
        ? pick(
            spec.key === "acme-air"
              ? [
                  "Gate code 4821",
                  "Dog in the backyard",
                  "Use the side entrance",
                  "Check in at the front desk",
                  "Parking in the rear lot",
                ]
              : [
                  "Lapor satpam di pos depan",
                  "Parkir di basement B1",
                  "Ada anjing di halaman",
                  "Hubungi pengelola gedung dulu",
                ],
          )
        : null,
      createdAt: owner.createdAt,
    });
  }
  const equipment: (typeof s.equipment.$inferInsert & { id: string; siteId: string })[] = [];
  for (let e = 0; e < spec.equipment; e++) {
    const site = e < sites.length ? sites[e]! : pick(sites);
    const kind = pick(spec.equipmentTypes);
    const brand = pick(kind.brands);
    const installed = new Date(ctx.now.getTime() - f.number.int({ min: 200, max: 4000 }) * DAY);
    equipment.push({
      id: uuidv7(),
      organizationId: orgId,
      siteId: site.id,
      type: kind.type,
      brand,
      model: `${brand.slice(0, 3).toUpperCase()}-${f.string.alphanumeric({ length: 5, casing: "upper" })}`,
      serial: f.string.alphanumeric({ length: 10, casing: "upper" }),
      installDate: installed.toISOString().slice(0, 10),
      warrantyEnd: new Date(installed.getTime() + 5 * 365 * DAY).toISOString().slice(0, 10),
    });
  }
  await insertBatches(
    tx,
    s.customer,
    customers.map((c) => ({
      id: c.id,
      organizationId: orgId,
      type: c.commercial ? "commercial" : "residential",
      name: c.name,
      tags: chance(0.35) ? f.helpers.arrayElements(spec.tags, { min: 1, max: 2 }) : [],
      notes: chance(0.15) ? pick(spec.customerNotes) : null,
      billingAddress: null,
      createdAt: c.createdAt,
      updatedAt: c.createdAt,
    })),
  );
  await insertBatches(tx, s.contact, contacts);
  await insertBatches(tx, s.site, sites);
  await insertBatches(tx, s.equipment, equipment);

  // ------------------------------------------------------------ jobs
  const anchor = localDate(new Date(ctx.now.getTime() + 8 * 3600_000), tz);
  const dayDate = (offset: number) => {
    const d = new Date(Date.UTC(anchor.y, anchor.m, anchor.d + offset));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
  };
  const futureDays = 7;
  const weights: { offset: number; w: number }[] = [];
  for (let off = -ctx.days; off <= futureDays; off++) {
    const dd = dayDate(off);
    const weekday = dd.dow === 0 ? 0.15 : dd.dow === 6 ? (spec.key === "acme-teknik" ? 0.7 : 0.4) : 1;
    // Future days are only partly booked.
    // Today is busy (DEM-03); later days are only partly booked.
    const booked = off === 0 ? 2.2 : off > 0 ? Math.max(0.3, 1.7 - off * 0.2) : 1;
    weights.push({ offset: off, w: spec.monthly[dd.m]! * weekday * booked });
  }
  const totalW = weights.reduce((a, b) => a + b.w, 0);
  const unscheduledCount = spec.key === "acme-air" ? 14 : 6;
  const scheduledTarget = spec.jobs - unscheduledCount;

  type GenJob = typeof s.job.$inferInsert & {
    id: string;
    events: (typeof s.jobEvent.$inferInsert)[];
    assignees: { memberId: string; isLead: boolean }[];
    notes: (typeof s.note.$inferInsert)[];
  };
  const jobs: GenJob[] = [];
  const busy = new Map<string, Slot[]>(); // memberId|day → slots

  // A title with the request texts written for it, so a job's description always matches its title. The random
  // draws (title, number, room, then the description) keep their order, so the rest of the demo stays the same.
  const titleFor = (st: (typeof serviceTypes)[number]) => {
    const t = pick(st.spec.titles);
    return {
      title: t.title
        .replace("{n}", String(f.number.int({ min: 2, max: 4 })))
        .replace("{room}", spec.key === "acme-air" ? pick(ROOMS) : pick(ROOMS_ID)),
      details: t.details,
    };
  };
  const priorityPick = () => {
    const r = f.number.float({ min: 0, max: 1 });
    return r < 0.15 ? "low" : r < 0.75 ? "normal" : r < 0.93 ? "high" : "urgent";
  };
  const sitesByCustomer = new Map<string, typeof sites>();
  for (const st of sites)
    sitesByCustomer.set(st.customerId, [...(sitesByCustomer.get(st.customerId) ?? []), st]);
  const equipmentBySite = new Map<string, typeof equipment>();
  for (const e of equipment) equipmentBySite.set(e.siteId, [...(equipmentBySite.get(e.siteId) ?? []), e]);
  // Repeat customers: a third of customers produce most of the work.
  const regulars = customers.slice(0, Math.ceil(customers.length / 3));
  const pickCustomer = () => (chance(0.55) ? pick(regulars) : pick(customers));
  const dispatcherUser = () => pick(dispatchers).userId;

  function placeVisit(day: { y: number; m: number; d: number }, durationMin: number, skills: string[]) {
    const capable = technicians.filter((t) => skills.every((sk) => t.skills.includes(sk)));
    const pool = capable.length ? capable : technicians;
    const key = (m: string) => `${m}|${day.y}-${day.m}-${day.d}`;
    const order = f.helpers.shuffle(pool);
    for (const tech of order) {
      const slots = busy.get(key(tech.id)) ?? [];
      const lastEnd = slots.length
        ? new Date(Math.max(...slots.map((x) => x.end.getTime())))
        : zoned(day.y, day.m, day.d, 8 * 60, tz);
      const travel = slots.length ? f.number.int({ min: 2, max: 5 }) * 10 : 0;
      const start = new Date(lastEnd.getTime() + travel * 60_000);
      const rounded = new Date(Math.ceil(start.getTime() / (15 * 60_000)) * 15 * 60_000);
      const end = new Date(rounded.getTime() + durationMin * 60_000);
      if (end <= zoned(day.y, day.m, day.d, 18 * 60, tz)) {
        busy.set(key(tech.id), [...slots, { start: rounded, end }]);
        return { tech, start: rounded, end };
      }
    }
    return null;
  }

  // A helper joins only when they are free for the whole visit.
  function reserveHelper(
    day: { y: number; m: number; d: number },
    placed: { tech: (typeof technicians)[number]; start: Date; end: Date },
  ) {
    const key = (m: string) => `${m}|${day.y}-${day.m}-${day.d}`;
    for (const t of f.helpers.shuffle(technicians)) {
      if (t.id === placed.tech.id || !t.skills.some((sk) => placed.tech.skills.includes(sk))) continue;
      const slots = busy.get(key(t.id)) ?? [];
      if (slots.some((x) => x.start < placed.end && placed.start < x.end)) continue;
      busy.set(key(t.id), [...slots, { start: placed.start, end: placed.end }]);
      return t;
    }
    return undefined;
  }

  // About 5% of past completed jobs needed a second visit (PRD §19): the first visit was put on hold for parts
  // and rescheduled. Chosen by a counter, not the random stream, so the rest of the seed stays the same.
  let pastCompleted = 0;
  let carry = 0;
  for (const { offset, w } of weights) {
    const exact = (w / totalW) * scheduledTarget + carry;
    const count = Math.floor(exact);
    carry = exact - count;
    const day = dayDate(offset);
    for (let k = 0; k < count; k++) {
      const st = f.helpers.weightedArrayElement(
        serviceTypes.map((x) => ({
          weight: Math.max(0.2, 1 + (x.spec.seasonal - 1) * spec.monthly[day.m]!),
          value: x,
        })),
      );
      const placed = placeVisit(day, st.defaultDurationMin, st.requiredSkills);
      if (!placed) continue;
      const cust = pickCustomer();
      const site = pick(sitesByCustomer.get(cust.id)!);
      const eqs = equipmentBySite.get(site.id) ?? [];
      const id = uuidv7();
      const leadDays = f.number.int({ min: 0, max: offset > 0 ? Math.min(6, 6) : 9 });
      let createdAt = new Date(
        placed.start.getTime() - leadDays * DAY - f.number.int({ min: 1, max: 9 }) * 3600_000,
      );
      if (createdAt > ctx.now)
        createdAt = new Date(ctx.now.getTime() - f.number.int({ min: 1, max: 48 }) * 3600_000);
      const helper = chance(0.12) ? reserveHelper(day, placed) : undefined;
      const assignees = [
        { memberId: placed.tech.id, isLead: true },
        ...(helper ? [{ memberId: helper.id, isLead: false }] : []),
      ];

      let status: string;
      if (offset < 0) {
        const r = f.number.float({ min: 0, max: 1 });
        const recent = offset >= -10;
        status = r < 0.06 ? "canceled" : recent && r < 0.1 ? "on_hold" : "completed";
      } else if (offset === 0) {
        const r = f.number.float({ min: 0, max: 1 });
        status = r < 0.3 ? "completed" : r < 0.45 ? "in_progress" : r < 0.55 ? "en_route" : "scheduled";
      } else {
        status = "scheduled";
      }

      // First visit of a job that needed a second one: same time of day, two or three days before the final visit.
      const callback =
        status === "completed" && offset < 0 && pastCompleted++ % 16 === 3
          ? new Date(placed.start.getTime() - (2 + (pastCompleted % 2)) * DAY)
          : null;
      const firstVisit =
        callback && callback.getTime() - createdAt.getTime() > 3 * 3600_000
          ? {
              start: callback,
              end: new Date(callback.getTime() + (placed.end.getTime() - placed.start.getTime())),
            }
          : null;
      const visit = firstVisit ?? placed;

      const by = dispatcherUser();
      const events: GenJob["events"] = [
        {
          organizationId: orgId,
          jobId: id,
          type: "created",
          fromStatus: null,
          toStatus: "new",
          actorUserId: by,
          payload: { source: "manual" },
          createdAt,
        },
      ];
      const assignedAt = new Date(
        Math.min(
          createdAt.getTime() + f.number.int({ min: 10, max: 180 }) * 60_000,
          visit.start.getTime() - 3600_000,
        ),
      );
      events.push({
        organizationId: orgId,
        jobId: id,
        type: "assigned",
        fromStatus: "new",
        toStatus: "scheduled",
        actorUserId: by,
        payload: {
          member_ids: assignees.map((a) => a.memberId),
          lead_member_id: placed.tech.id,
          scheduled_start: visit.start.toISOString(),
          scheduled_end: visit.end.toISOString(),
        },
        createdAt: assignedAt < createdAt ? createdAt : assignedAt,
      });
      const techUser = placed.tech.userId;
      const ev = (
        from: string,
        to: string,
        at: Date,
        transition: string,
        payload: Record<string, unknown> = {},
        actor = techUser,
      ) =>
        events.push({
          organizationId: orgId,
          jobId: id,
          type: "status_changed",
          fromStatus: from,
          toStatus: to,
          actorUserId: actor,
          payload: { transition, ...payload },
          createdAt: at,
        });
      const departAt = new Date(placed.start.getTime() - 25 * 60_000);
      let completedAt: Date | null = null;
      let canceledAt: Date | null = null;
      let holdReason: string | null = null;
      const notes: GenJob["notes"] = [];
      if (status === "canceled") {
        canceledAt = new Date(placed.start.getTime() - f.number.int({ min: 2, max: 30 }) * 3600_000);
        if (canceledAt < createdAt) canceledAt = new Date(createdAt.getTime() + 3600_000);
        ev(
          "scheduled",
          "canceled",
          canceledAt,
          "cancel",
          {
            reason:
              spec.key === "acme-air"
                ? pick(["Customer canceled", "Duplicate request", "Customer fixed it themselves"])
                : pick(["Dibatalkan pelanggan", "Permintaan ganda"]),
          },
          by,
        );
      }
      if (firstVisit) {
        const at = (min: number) => new Date(firstVisit.start.getTime() + min * 60_000);
        ev("scheduled", "en_route", at(-25), "depart");
        ev("en_route", "in_progress", firstVisit.start, "start");
        ev("in_progress", "on_hold", at(40), "hold", {
          reason: spec.holdNotes[pastCompleted % spec.holdNotes.length],
          hold_reason: "parts",
        });
        events.push({
          organizationId: orgId,
          jobId: id,
          type: "assigned",
          fromStatus: "on_hold",
          toStatus: "scheduled",
          actorUserId: by,
          payload: {
            member_ids: assignees.map((a) => a.memberId),
            lead_member_id: placed.tech.id,
            scheduled_start: placed.start.toISOString(),
            scheduled_end: placed.end.toISOString(),
          },
          createdAt: at(180),
        });
      }
      if (["en_route", "in_progress", "on_hold", "completed"].includes(status))
        ev("scheduled", "en_route", departAt, "depart");
      if (["in_progress", "on_hold", "completed"].includes(status))
        ev("en_route", "in_progress", placed.start, "start");
      if (status === "on_hold") {
        holdReason = pick(["parts", "customer", "access"]);
        ev("in_progress", "on_hold", new Date(placed.start.getTime() + 40 * 60_000), "hold", {
          reason: pick(spec.holdNotes),
          hold_reason: holdReason,
        });
      }
      if (status === "completed") {
        completedAt = new Date(placed.end.getTime() + f.number.int({ min: -20, max: 25 }) * 60_000);
        ev("in_progress", "completed", completedAt, "complete");
        if (chance(0.38)) {
          const visibility = chance(0.25) ? "customer" : "internal";
          notes.push({
            organizationId: orgId,
            jobId: id,
            authorUserId: techUser,
            body: pick(spec.notes),
            visibility,
            createdAt: completedAt,
          });
          events.push({
            organizationId: orgId,
            jobId: id,
            type: "note_added",
            fromStatus: null,
            toStatus: null,
            actorUserId: techUser,
            payload: { visibility },
            createdAt: completedAt,
          });
        }
      }

      const equipmentId = eqs.length && chance(0.6) ? pick(eqs).id : null;
      const titled = titleFor(st);
      const description = chance(0.7) ? pick(titled.details) : null;
      jobs.push({
        id,
        organizationId: orgId,
        number: 0,
        customerId: cust.id,
        siteId: site.id,
        equipmentId,
        serviceTypeId: st.id,
        title: titled.title,
        description,
        priority: priorityPick(),
        status,
        source: chance(0.25) ? "portal" : chance(0.05) ? "api" : "manual",
        holdReason,
        scheduledStart: placed.start,
        scheduledEnd: placed.end,
        completedAt,
        canceledAt,
        estimatedDurationMin: st.defaultDurationMin,
        createdBy: by,
        createdAt,
        updatedAt: completedAt ?? canceledAt ?? assignedAt,
        version: events.length,
        events,
        assignees,
        notes,
      });
    }
  }

  // Unscheduled queue: recent requests waiting for a dispatcher, a few urgent, a few portal requests to review.
  for (let k = 0; k < unscheduledCount; k++) {
    const st = pick(serviceTypes);
    const cust = pickCustomer();
    const site = pick(sitesByCustomer.get(cust.id)!);
    const id = uuidv7();
    const createdAt = new Date(ctx.now.getTime() - f.number.int({ min: 20, max: 60 * 60 }) * 60_000);
    const portal = k % 4 === 0;
    const by = dispatcherUser();
    const titled = titleFor(st);
    const description = pick(titled.details);
    jobs.push({
      id,
      organizationId: orgId,
      number: 0,
      customerId: cust.id,
      siteId: site.id,
      equipmentId: null,
      serviceTypeId: st.id,
      title: titled.title,
      description,
      priority: k % 5 === 0 ? "urgent" : priorityPick(),
      status: "new",
      source: portal ? "portal" : "manual",
      needsReview: portal,
      estimatedDurationMin: st.defaultDurationMin,
      createdBy: portal ? null : by,
      createdAt,
      updatedAt: createdAt,
      version: 1,
      events: [
        {
          organizationId: orgId,
          jobId: id,
          type: "created",
          fromStatus: null,
          toStatus: "new",
          actorUserId: portal ? null : by,
          payload: { source: portal ? "portal" : "manual" },
          createdAt,
        },
      ],
      assignees: [],
      notes: [],
    });
  }

  jobs.sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
  jobs.forEach((j, i) => (j.number = i + 1));
  await insertBatches(
    tx,
    s.job,
    jobs.map(({ events: _e, assignees: _a, notes: _n, ...row }) => row),
  );
  await insertBatches(
    tx,
    s.jobAssignment,
    jobs.flatMap((j) =>
      j.assignees.map((a) => ({
        organizationId: orgId,
        jobId: j.id,
        memberId: a.memberId,
        isLead: a.isLead,
        createdAt: j.createdAt,
      })),
    ),
  );
  await insertBatches(
    tx,
    s.jobEvent,
    jobs.flatMap((j) => j.events),
  );
  await insertBatches(
    tx,
    s.note,
    jobs.flatMap((j) => j.notes),
  );
  await tx.insert(s.orgCounter).values({ organizationId: orgId, name: "job", value: jobs.length });

  // KPI columns derived from the timeline (same rules as the services, DSH-01).
  await tx.execute(sql`
    update job j set first_scheduled_at = e.first_at
    from (select job_id, min(created_at) as first_at from job_event
          where organization_id = ${orgId} and to_status = 'scheduled' group by job_id) e
    where j.organization_id = ${orgId} and e.job_id = j.id`);
  await tx.execute(sql`
    update job j set revisit = true
    where j.organization_id = ${orgId} and exists (
      select 1 from job_event e where e.organization_id = ${orgId} and e.job_id = j.id
        and e.type in ('status_changed', 'assigned')
        and ((e.from_status = 'on_hold' and e.to_status = 'scheduled') or (e.from_status = 'completed' and e.to_status = 'in_progress')))`);

  // Extensions, each with its own deterministic random stream so they don't shift each other.
  const ext: SeedContext = {
    tx,
    orgId,
    spec,
    now: ctx.now,
    seed: ctx.seed,
    timeZone: tz,
    members,
    serviceTypes: serviceTypes.map(({ spec: st, ...row }) => ({ ...row, spec: st })),
    customers,
    sites,
    equipment,
    jobs,
  };
  await seedDispatch(ext);
  await seedFieldwork(ext);
  await seedExpenses(ext);
  await seedInsights(ext);
  // 0.3 extensions. SLA first (deadlines and states on every job), then portal requests, their AI drafts,
  // notifications about all of the above, and finally the audit history.
  await seedSla(ext);
  await seedPortal(ext);
  await seedAi(ext);
  await seedNotifications(ext);
  await seedAudit(ext);

  return {
    org: { id: orgId, slug: spec.slug, name: spec.name, jobs: jobs.length, customers: customers.length },
    demoUsers,
  };
}

function requiredSkills(serviceName: string): string[] {
  const n = serviceName.toLowerCase();
  if (n.includes("install") || n.includes("pasang")) return ["install"];
  if (n.includes("refrigerant") || n.includes("freon")) return ["refrigerant"];
  if (n.includes("duct")) return ["duct"];
  if (n.includes("clean") && !n.includes("cuci")) return ["cleaning"];
  return ["ac"];
}
