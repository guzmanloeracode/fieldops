import {
  billableHours,
  computeTotals,
  dates,
  defaultTaxRate,
  formatYearlyNumber,
  markedUp,
  type LineAmounts,
} from "@fieldops/core";
import { REMINDER_DAYS, type LineKind, type PaymentMethod } from "@fieldops/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import { DEMO_PORTAL_LOGINS } from "./portal";
import { extensionFaker, type SeedContext } from "./context";
import { DAY, insertBatches, zoned } from "./time";

// Catalog, quotes, invoices and payments (FIN-01–07, EXP-04). Offset 9. Every random draw comes from this file's
// own faker, in a fixed order (jobs in number order, parts by request time, technicians by name), so the seed
// stays deterministic and the other extensions' draws don't move. Approved quotes are linked to existing manual
// jobs (the job's source becomes "quote"); that changes no random draw elsewhere.

const MINUTE = 60_000;

interface CatalogSpec {
  kind: "part" | "fee";
  name: string;
  sku: string;
  unit: string;
  price: number;
  cost?: number;
}

const CATALOG: Record<"acme-air" | "acme-teknik", CatalogSpec[]> = {
  "acme-air": [
    {
      kind: "part",
      name: "Air filter 16×25×1 (MERV 11)",
      sku: "FLT-16251-M11",
      unit: "each",
      price: 14.5,
      cost: 6.2,
    },
    { kind: "part", name: "Run capacitor 45/5 µF", sku: "CAP-455", unit: "each", price: 39, cost: 18.5 },
    { kind: "part", name: "Contactor 30A 2-pole", sku: "CON-30A2", unit: "each", price: 59, cost: 32 },
    { kind: "part", name: "Refrigerant R-410A", sku: "REF-410A", unit: "lb", price: 65, cost: 28 },
    {
      kind: "part",
      name: "Condensate pump with safety switch",
      sku: "PMP-CSS",
      unit: "each",
      price: 219,
      cost: 129,
    },
    { kind: "part", name: "Programmable thermostat", sku: "TST-PRG", unit: "each", price: 149, cost: 85 },
    {
      kind: "part",
      name: "Condenser fan motor 1/4 HP",
      sku: "MTR-CF14",
      unit: "each",
      price: 289,
      cost: 165,
    },
    { kind: "part", name: "UV air purifier lamp", sku: "UVL-24", unit: "each", price: 129, cost: 58 },
    { kind: "fee", name: "Emergency call-out fee", sku: "FEE-EMRG", unit: "each", price: 95 },
    { kind: "fee", name: "Trip charge", sku: "FEE-TRIP", unit: "each", price: 49 },
    { kind: "fee", name: "Old equipment disposal", sku: "FEE-DISP", unit: "unit", price: 35 },
  ],
  "acme-teknik": [
    { kind: "part", name: "Freon R32", sku: "FRN-R32", unit: "kg", price: 350_000, cost: 210_000 },
    { kind: "part", name: "Kapasitor AC 35 µF", sku: "KAP-35", unit: "buah", price: 95_000, cost: 55_000 },
    {
      kind: "part",
      name: "Pipa tembaga 1/4 + 3/8",
      sku: "PIP-1438",
      unit: "m",
      price: 145_000,
      cost: 90_000,
    },
    { kind: "part", name: "Remote AC universal", sku: "RMT-UNV", unit: "buah", price: 85_000, cost: 40_000 },
    { kind: "part", name: "Kabel NYM 3×2,5 mm²", sku: "KBL-NYM325", unit: "m", price: 22_000, cost: 13_000 },
    { kind: "part", name: "Bracket outdoor", sku: "BRK-OUT", unit: "set", price: 175_000, cost: 95_000 },
    {
      kind: "part",
      name: "Pompa drainase mini",
      sku: "PMP-MINI",
      unit: "buah",
      price: 650_000,
      cost: 420_000,
    },
    { kind: "part", name: "Sensor thermistor", sku: "SNS-THR", unit: "buah", price: 120_000, cost: 60_000 },
    { kind: "fee", name: "Biaya transport", sku: "FEE-TRANS", unit: "kali", price: 50_000 },
    { kind: "fee", name: "Biaya bongkar unit lama", sku: "FEE-BKR", unit: "unit", price: 150_000 },
  ],
};

/** Parts that go with each service type, so a quote's parts match its service. */
const SERVICE_PARTS: Record<"acme-air" | "acme-teknik", Record<string, string[]>> = {
  "acme-air": {
    "AC tune-up": ["Air filter 16×25×1 (MERV 11)", "Run capacitor 45/5 µF"],
    "AC repair": ["Run capacitor 45/5 µF", "Contactor 30A 2-pole", "Condenser fan motor 1/4 HP"],
    "AC installation": ["Programmable thermostat", "Condensate pump with safety switch"],
    "Refrigerant recharge": ["Refrigerant R-410A"],
    "Duct cleaning": ["UV air purifier lamp", "Air filter 16×25×1 (MERV 11)"],
    "Filter replacement": ["Air filter 16×25×1 (MERV 11)"],
  },
  "acme-teknik": {
    "Cuci AC": ["Freon R32"],
    "Perbaikan AC": ["Kapasitor AC 35 µF", "Sensor thermistor", "Pompa drainase mini"],
    "Pasang AC baru": ["Pipa tembaga 1/4 + 3/8", "Kabel NYM 3×2,5 mm²", "Bracket outdoor"],
    "Isi freon": ["Freon R32"],
    "Bongkar pasang AC": ["Pipa tembaga 1/4 + 3/8", "Kabel NYM 3×2,5 mm²"],
  },
};

/** Fees a quote can carry: the trip charge anywhere, disposal of the old unit only with an installation. */
const QUOTE_FEES: Record<"acme-air" | "acme-teknik", { trip: string; disposal: string; install: string[] }> =
  {
    "acme-air": { trip: "Trip charge", disposal: "Old equipment disposal", install: ["AC installation"] },
    "acme-teknik": {
      trip: "Biaya transport",
      disposal: "Biaya bongkar unit lama",
      install: ["Pasang AC baru", "Bongkar pasang AC"],
    },
  };

interface QuoteIdea {
  title: string;
  service: string;
  quantity?: number;
  parts: readonly (readonly [string, number])[];
}

const TEXT = {
  "acme-air": {
    labor: (name: string) => `Labor: ${name}`,
    quoteIdeas: [
      {
        title: "Replace the condenser fan motor",
        service: "AC repair",
        parts: [
          ["Condenser fan motor 1/4 HP", 1],
          ["Run capacitor 45/5 µF", 1],
        ],
      },
      {
        title: "Install a ductless mini-split in the home office",
        service: "AC installation",
        parts: [["Condensate pump with safety switch", 1]],
      },
      {
        title: "Seasonal maintenance for three units",
        service: "AC tune-up",
        quantity: 3,
        parts: [["Air filter 16×25×1 (MERV 11)", 3]],
      },
      {
        title: "Upgrade to a programmable thermostat",
        service: "AC repair",
        parts: [["Programmable thermostat", 1]],
      },
      { title: "Duct cleaning and UV lamp", service: "Duct cleaning", parts: [["UV air purifier lamp", 1]] },
      {
        title: "Condensate pump replacement",
        service: "AC repair",
        parts: [["Condensate pump with safety switch", 1]],
      },
    ],
    quoteNotes: "Prices include parts and labor. The quote is valid until the date above.",
    declines: [
      "Going with a cheaper offer",
      "Postponing until next season",
      "Budget not approved this quarter",
    ],
    voidReason: "Billed to the wrong customer",
    instructions:
      "Bank transfer to Acme Air & Clean LLC, account 0001 2345 6789, routing 111000025. Please put the invoice number in the reference.",
  },
  "acme-teknik": {
    labor: (name: string) => `Jasa teknisi: ${name}`,
    quoteIdeas: [
      {
        title: "Pasang AC split 1 PK baru",
        service: "Pasang AC baru",
        parts: [
          ["Pipa tembaga 1/4 + 3/8", 4],
          ["Kabel NYM 3×2,5 mm²", 6],
          ["Bracket outdoor", 1],
        ],
      },
      { title: "Ganti kapasitor AC kamar", service: "Perbaikan AC", parts: [["Kapasitor AC 35 µF", 1]] },
      { title: "Cuci AC 4 unit dan isi freon", service: "Cuci AC", quantity: 4, parts: [["Freon R32", 2]] },
      {
        title: "Pindah unit AC ke lantai 2",
        service: "Bongkar pasang AC",
        parts: [
          ["Pipa tembaga 1/4 + 3/8", 5],
          ["Kabel NYM 3×2,5 mm²", 8],
        ],
      },
      { title: "Perawatan rutin AC kantor", service: "Perawatan gedung", parts: [] },
      { title: "Ganti pompa drainase", service: "Perbaikan AC", parts: [["Pompa drainase mini", 1]] },
    ],
    quoteNotes: "Harga sudah termasuk material dan jasa. Penawaran berlaku sampai tanggal di atas.",
    declines: [
      "Anggaran belum tersedia bulan ini",
      "Memilih penawaran lain",
      "Ditunda sampai renovasi selesai",
    ],
    voidReason: "Salah pelanggan",
    instructions:
      "Transfer ke BCA 123-456-7890 a.n. PT Acme Teknik Indonesia. Cantumkan nomor faktur pada berita transfer.",
  },
} as const;

type Line = LineAmounts & {
  kind: LineKind;
  description: string;
  unit: string | null;
  catalogItemId: string | null;
  serviceTypeId: string | null;
  expenseRequestId?: string | null;
  unitCostMinor?: number | null;
  markupBps?: number;
};

const localDay = (instant: Date, tz: string) => dates.localDateString(instant, tz);
const at = (date: string, minutes: number, tz: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return zoned(y, m - 1, d, minutes, tz);
};

export async function seedBilling(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 9);
  const { tx, orgId, spec, now, timeZone: tz } = ctx;
  const key = spec.key;
  const text = TEXT[key];
  const minor = (major: number) => Math.round(major * 100);
  const chance = (p: number) => f.number.float({ min: 0, max: 1 }) < p;
  const today = localDay(now, tz);
  const taxRate = defaultTaxRate(spec.taxRates);
  const billing = {
    paymentTermsDays: 14,
    quoteValidityDays: 30,
    laborRateMinor: key === "acme-air" ? 95_00 : 150_000_00,
  };
  await tx.execute(sql`
    update organization set settings = settings || ${JSON.stringify({
      billing: {
        payment_terms_days: billing.paymentTermsDays,
        quote_validity_days: billing.quoteValidityDays,
        labor_rate_minor: billing.laborRateMinor,
        invoice_prefix: "INV",
        quote_prefix: "QUO",
        reminders_enabled: true,
        payment_instructions: text.instructions,
      },
    })}::jsonb where id = ${orgId}`);

  // ------------------------------------------------------------ catalog
  const catalog = CATALOG[key].map((c) => ({
    id: uuidv7(),
    organizationId: orgId,
    kind: c.kind,
    name: c.name,
    sku: c.sku,
    unit: c.unit,
    unitPriceMinor: minor(c.price),
    unitCostMinor: c.cost === undefined ? null : minor(c.cost),
    currency: spec.currency,
    taxRateBps: null,
    active: true,
    createdAt: new Date(now.getTime() - 200 * DAY),
    updatedAt: new Date(now.getTime() - 200 * DAY),
  }));
  await insertBatches(tx, s.catalogItem, catalog);
  const parts = catalog.filter((c) => c.kind === "part");
  const fees = catalog.filter((c) => c.kind === "fee");

  // ------------------------------------------------------------ what the other seeds made
  const office = ctx.members.filter((m) => m.role === "owner" || m.role === "dispatcher");
  const officeUser = () => f.helpers.arrayElement(office).userId;
  const owner = ctx.members.find((m) => m.role === "owner")!;
  const memberName = new Map(ctx.members.map((m) => [m.id, m.name]));
  const serviceType = new Map(ctx.serviceTypes.map((st) => [st.id, st]));
  const contacts = await tx
    .select({
      id: s.contact.id,
      customerId: s.contact.customerId,
      email: s.contact.email,
      primary: s.contact.isPrimary,
    })
    .from(s.contact)
    .where(eq(s.contact.organizationId, orgId));
  const billTo = new Map<string, string>();
  for (const c of contacts) {
    if (!c.email) continue;
    if (c.primary || !billTo.has(c.customerId)) billTo.set(c.customerId, c.id);
  }
  const login = DEMO_PORTAL_LOGINS[key];
  const demoContact = contacts.find((c) => c.email === login.email);
  const demoCustomerId = demoContact?.customerId ?? null;

  const completed = ctx.jobs.filter((j) => j.status === "completed" && j.completedAt && j.completedAt <= now);
  const completedIds = completed.map((j) => j.id);
  const work = completedIds.length
    ? await tx
        .select({
          jobId: s.timeEntry.jobId,
          memberId: s.timeEntry.memberId,
          minutes: sql<number>`sum(extract(epoch from (${s.timeEntry.endedAt} - ${s.timeEntry.startedAt})) / 60)::float8`,
        })
        .from(s.timeEntry)
        .where(
          and(
            eq(s.timeEntry.organizationId, orgId),
            eq(s.timeEntry.kind, "work"),
            sql`${s.timeEntry.endedAt} is not null`,
            inArray(s.timeEntry.jobId, completedIds),
          ),
        )
        .groupBy(s.timeEntry.jobId, s.timeEntry.memberId)
    : [];
  const workByJob = new Map<string, { name: string; minutes: number }[]>();
  for (const w of work) {
    const list = workByJob.get(w.jobId) ?? [];
    list.push({ name: memberName.get(w.memberId) ?? "", minutes: Number(w.minutes) });
    workByJob.set(w.jobId, list);
  }
  for (const list of workByJob.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const expenses = completedIds.length
    ? await tx
        .select()
        .from(s.expenseRequest)
        .where(
          and(
            eq(s.expenseRequest.organizationId, orgId),
            eq(s.expenseRequest.status, "approved"),
            eq(s.expenseRequest.billable, true),
            inArray(s.expenseRequest.jobId, completedIds),
          ),
        )
        .orderBy(asc(s.expenseRequest.createdAt), asc(s.expenseRequest.item))
    : [];
  const expensesByJob = new Map<string, (typeof expenses)[number][]>();
  for (const e of expenses) expensesByJob.set(e.jobId, [...(expensesByJob.get(e.jobId) ?? []), e]);

  // ------------------------------------------------------------ quotes
  const quoteRows: (typeof s.quote.$inferInsert)[] = [];
  const quoteLines: (typeof s.quoteLine.$inferInsert)[] = [];
  const quoteLinesById = new Map<string, Line[]>();
  const quoteByJob = new Map<string, string>();
  const jobUpdates: { id: string; quoteId: string; number: string }[] = [];

  const partByName = new Map(parts.map((p) => [p.name, p]));
  const feeByName = new Map(fees.map((c) => [c.name, c]));
  const partLine = (p: (typeof parts)[number], quantity: number): Line => ({
    kind: "part",
    description: p.name,
    quantity,
    unit: p.unit,
    unitPriceMinor: p.unitPriceMinor,
    taxRateBps: taxRate,
    catalogItemId: p.id,
    serviceTypeId: null,
  });
  const bulk = (unit: string) => unit === "lb" || unit === "kg" || unit === "m";

  /** The service, parts that fit it (or the idea's own parts) and sometimes a fee that fits too. */
  function quoteLinesFor(stId: string | null, idea?: QuoteIdea): Line[] {
    const st = stId ? serviceType.get(stId) : undefined;
    const lines: Line[] = [];
    if (st) {
      lines.push({
        kind: "service",
        description: st.name,
        quantity: idea?.quantity ?? 1,
        unit: null,
        unitPriceMinor: st.defaultPriceMinor,
        taxRateBps: taxRate,
        catalogItemId: null,
        serviceTypeId: st.id,
      });
    }
    if (idea) {
      for (const [name, quantity] of idea.parts) lines.push(partLine(partByName.get(name)!, quantity));
    } else {
      const fitting = (st ? (SERVICE_PARTS[key][st.name] ?? []) : []).map((n) => partByName.get(n)!);
      for (const p of f.helpers.arrayElements(
        fitting,
        f.number.int({ min: 0, max: Math.min(2, fitting.length) }),
      )) {
        lines.push(partLine(p, bulk(p.unit) ? f.number.int({ min: 2, max: 6 }) : 1));
      }
    }
    if (chance(0.3)) {
      const pool = [QUOTE_FEES[key].trip];
      if (st && QUOTE_FEES[key].install.includes(st.name)) pool.push(QUOTE_FEES[key].disposal);
      const fee = feeByName.get(f.helpers.arrayElement(pool))!;
      lines.push({
        kind: "fee",
        description: fee.name,
        quantity: 1,
        unit: fee.unit,
        unitPriceMinor: fee.unitPriceMinor,
        taxRateBps: taxRate,
        catalogItemId: fee.id,
        serviceTypeId: null,
      });
    }
    return lines;
  }

  const quoteCounters = new Map<number, number>();
  function addQuote(q: {
    customerId: string;
    siteId: string;
    serviceTypeId: string | null;
    title: string;
    status: "draft" | "sent" | "approved" | "declined" | "expired";
    createdAt: Date;
    decidedAt?: Date;
    jobId?: string;
    idea?: QuoteIdea;
  }) {
    const id = uuidv7();
    const lines = quoteLinesFor(q.serviceTypeId, q.idea);
    const discount = chance(0.2) ? { type: "percent" as const, value: 500 } : { type: null, value: 0 };
    const totals = computeTotals(lines, discount);
    const created = localDay(q.createdAt, tz);
    const sentAt =
      q.status === "draft"
        ? null
        : new Date(q.createdAt.getTime() + f.number.int({ min: 20, max: 180 }) * MINUTE);
    quoteRows.push({
      id,
      organizationId: orgId,
      number: "",
      customerId: q.customerId,
      siteId: q.siteId,
      contactId: billTo.get(q.customerId) ?? null,
      serviceTypeId: q.serviceTypeId,
      jobId: q.jobId ?? null,
      title: q.title,
      notes: chance(0.6) ? text.quoteNotes : null,
      status: q.status,
      currency: spec.currency,
      discountType: discount.type,
      discountValue: discount.value,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      validUntil: dates.addDays(created, billing.quoteValidityDays),
      sentAt,
      decidedAt: q.decidedAt ?? null,
      decidedByUserId: q.decidedAt ? officeUser() : null,
      declineReason: q.status === "declined" ? f.helpers.arrayElement(text.declines) : null,
      createdBy: officeUser(),
      createdAt: q.createdAt,
      updatedAt: q.decidedAt ?? sentAt ?? q.createdAt,
    });
    lines.forEach((l, i) =>
      quoteLines.push({
        organizationId: orgId,
        quoteId: id,
        position: i,
        kind: l.kind,
        catalogItemId: l.catalogItemId,
        serviceTypeId: l.serviceTypeId,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceMinor: l.unitPriceMinor,
        taxRateBps: l.taxRateBps,
        netMinor: totals.lines[i]!.netMinor,
        taxMinor: totals.lines[i]!.taxMinor,
        createdAt: q.createdAt,
      }),
    );
    quoteLinesById.set(id, lines);
    if (q.jobId) quoteByJob.set(q.jobId, id);
    return id;
  }

  // Approved quotes became some of the manual jobs of the last three months.
  const linkable = ctx.jobs.filter(
    (j) =>
      j.source === "manual" &&
      j.status !== "canceled" &&
      j.createdAt! < new Date(now.getTime() - 3 * DAY) &&
      j.createdAt! > new Date(now.getTime() - 90 * DAY),
  );
  for (const job of f.helpers.arrayElements(
    linkable,
    Math.min(linkable.length, key === "acme-air" ? 5 : 3),
  )) {
    const decidedAt = new Date(job.createdAt!.getTime() - f.number.int({ min: 5, max: 90 }) * MINUTE);
    const createdAt = new Date(decidedAt.getTime() - f.number.int({ min: 2, max: 9 }) * DAY);
    const id = addQuote({
      customerId: job.customerId,
      siteId: job.siteId,
      serviceTypeId: job.serviceTypeId ?? null,
      title: job.title,
      status: "approved",
      createdAt,
      decidedAt,
      jobId: job.id,
    });
    jobUpdates.push({ id: job.id, quoteId: id, number: "" });
    job.source = "quote";
  }

  // Quotes in every other state, over the last three months.
  const withSites = ctx.customers.filter((c) => ctx.sites.some((x) => x.customerId === c.id));
  const plan: { status: "draft" | "sent" | "declined" | "expired"; ageDays: [number, number] }[] = [
    { status: "draft", ageDays: [0, 6] },
    { status: "draft", ageDays: [1, 10] },
    { status: "sent", ageDays: [1, 12] },
    { status: "sent", ageDays: [3, 20] },
    { status: "sent", ageDays: [5, 25] },
    { status: "declined", ageDays: [15, 60] },
    { status: "declined", ageDays: [20, 80] },
    { status: "expired", ageDays: [40, 70] },
    { status: "expired", ageDays: [45, 85] },
  ];
  for (const [i, p] of plan.entries()) {
    const demo = i === 2 && demoCustomerId;
    const customer = demo ? demoCustomerId : f.helpers.arrayElement(withSites).id;
    const siteId = ctx.sites.find((x) => x.customerId === customer)!.id;
    const idea = f.helpers.arrayElement<QuoteIdea>(text.quoteIdeas);
    const st = ctx.serviceTypes.find((x) => x.name === idea.service)!;
    const createdAt = new Date(
      now.getTime() -
        f.number.int({ min: p.ageDays[0] * 24 * 60, max: p.ageDays[1] * 24 * 60 + 600 }) * MINUTE,
    );
    addQuote({
      customerId: customer,
      siteId,
      serviceTypeId: st.id,
      title: idea.title,
      idea,
      status: p.status,
      createdAt,
      decidedAt:
        p.status === "declined"
          ? new Date(createdAt.getTime() + f.number.int({ min: 1, max: 6 }) * DAY)
          : undefined,
    });
  }
  quoteRows.sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
  for (const q of quoteRows) {
    const year = Number(localDay(q.createdAt!, tz).slice(0, 4));
    const n = (quoteCounters.get(year) ?? 0) + 1;
    quoteCounters.set(year, n);
    q.number = formatYearlyNumber("QUO", year, n);
  }
  for (const u of jobUpdates) u.number = quoteRows.find((q) => q.id === u.quoteId)!.number;
  await insertBatches(tx, s.quote, quoteRows);
  await insertBatches(tx, s.quoteLine, quoteLines);
  for (const u of jobUpdates) {
    await tx
      .update(s.job)
      .set({ source: "quote" })
      .where(and(eq(s.job.organizationId, orgId), eq(s.job.id, u.id)));
    await tx.execute(sql`
      update job_event set payload = ${JSON.stringify({ source: "quote", quote_id: u.quoteId, quote_number: u.number })}::jsonb
       where organization_id = ${orgId} and job_id = ${u.id} and type = 'created'`);
  }

  // ------------------------------------------------------------ invoices
  interface Draft {
    id: string;
    job: (typeof completed)[number];
    lines: Line[];
    totals: ReturnType<typeof computeTotals>;
    discount: { type: "percent" | "amount" | null; value: number };
    createdAt: Date;
    issueDate: string | null;
  }
  const drafts: Draft[] = [];
  const recent = new Date(now.getTime() - 2 * DAY);
  const demoJobs = completed.filter((j) => j.customerId === demoCustomerId);
  const demoLatest = demoJobs.at(-1)?.id;
  for (const job of completed) {
    const isDemo = job.id === demoLatest;
    if (!isDemo && !chance(0.88)) continue;
    const lines: Line[] = [];
    const fromQuote = quoteByJob.get(job.id);
    if (fromQuote) lines.push(...quoteLinesById.get(fromQuote)!);
    else if (job.serviceTypeId) {
      const st = serviceType.get(job.serviceTypeId)!;
      lines.push({
        kind: "service",
        description: st.name,
        quantity: 1,
        unit: null,
        unitPriceMinor: st.defaultPriceMinor,
        taxRateBps: taxRate,
        catalogItemId: null,
        serviceTypeId: st.id,
      });
    }
    for (const w of workByJob.get(job.id) ?? []) {
      const hours = billableHours(w.minutes);
      if (hours <= 0) continue;
      lines.push({
        kind: "labor",
        description: text.labor(w.name),
        quantity: hours,
        unit: "h",
        unitPriceMinor: billing.laborRateMinor,
        taxRateBps: taxRate,
        catalogItemId: null,
        serviceTypeId: null,
      });
    }
    for (const e of expensesByJob.get(job.id) ?? []) {
      const markup = e.kind === "part" ? f.helpers.arrayElement([0, 1500, 2500]) : 0;
      lines.push({
        kind: e.kind === "part" ? "part" : "expense",
        description: e.item,
        quantity: Number(e.quantity),
        unit: null,
        unitPriceMinor: markedUp(e.unitCostMinor, markup),
        taxRateBps: taxRate,
        catalogItemId: null,
        serviceTypeId: null,
        expenseRequestId: e.id,
        unitCostMinor: e.unitCostMinor,
        markupBps: markup,
      });
    }
    if (lines.length === 0) continue;
    const discount = chance(0.08) ? { type: "percent" as const, value: 1000 } : { type: null, value: 0 };
    const createdAt = new Date(job.completedAt!.getTime() + f.number.int({ min: 30, max: 6 * 60 }) * MINUTE);
    const draft = job.completedAt! > recent && !isDemo && chance(0.5);
    const issueDate = draft
      ? null
      : (() => {
          const d = dates.addDays(localDay(job.completedAt!, tz), chance(0.6) ? 0 : 1);
          return d > today ? today : d;
        })();
    drafts.push({
      id: uuidv7(),
      job,
      lines,
      totals: computeTotals(lines, discount),
      discount,
      createdAt: createdAt > now ? now : createdAt,
      issueDate,
    });
  }

  // Numbers in issue order, per year (gap-free).
  const issued = drafts
    .filter((d) => d.issueDate)
    .sort((a, b) => a.issueDate!.localeCompare(b.issueDate!) || a.job.number - b.job.number);
  const invoiceCounters = new Map<number, number>();
  const numberOf = new Map<string, string>();
  for (const d of issued) {
    const year = Number(d.issueDate!.slice(0, 4));
    const n = (invoiceCounters.get(year) ?? 0) + 1;
    invoiceCounters.set(year, n);
    numberOf.set(d.id, formatYearlyNumber("INV", year, n));
  }

  const methods: PaymentMethod[] =
    key === "acme-air"
      ? ["card", "card", "bank_transfer", "bank_transfer", "cash", "other"]
      : ["bank_transfer", "bank_transfer", "bank_transfer", "cash", "other"];
  const invoiceRows: (typeof s.invoice.$inferInsert)[] = [];
  const invoiceLines: (typeof s.invoiceLine.$inferInsert)[] = [];
  const payments: (typeof s.payment.$inferInsert)[] = [];
  const reminders: (typeof s.invoiceReminder.$inferInsert)[] = [];
  const events: (typeof s.jobEvent.$inferInsert)[] = [];
  let voided = false;
  const demoInvoice = drafts.find((d) => d.job.id === demoLatest)?.id;

  for (const d of drafts) {
    const total = d.totals.totalMinor;
    const number = numberOf.get(d.id) ?? null;
    let status: "draft" | "sent" | "paid" | "overdue" | "void" = number ? "sent" : "draft";
    let dueDate: string | null = null;
    let sentAt: Date | null = null;
    let paid = 0;
    let paidAt: Date | null = null;
    let voidedAt: Date | null = null;
    if (number) {
      dueDate = dates.addDays(d.issueDate!, billing.paymentTermsDays);
      sentAt = at(d.issueDate!, f.number.int({ min: 8 * 60, max: 17 * 60 }), tz);
      if (sentAt < d.createdAt) sentAt = new Date(d.createdAt.getTime() + 5 * MINUTE);
      if (sentAt > now) sentAt = now;
      const age = dates.daysInclusive(d.issueDate!, today) - 1;
      const pastDue = dueDate < today;
      // Nothing issued today is paid yet, and the demo portal customer always has an unpaid invoice.
      const pPaid = d.id === demoInvoice || age < 1 ? 0 : !pastDue ? 0.45 : age > 45 ? 0.97 : 0.8;
      const payDay = (min: number, max: number) => {
        const day = dates.addDays(d.issueDate!, f.number.int({ min, max: Math.max(min, max) }));
        const when = at(day > today ? today : day, f.number.int({ min: 9 * 60, max: 17 * 60 }), tz).getTime();
        return new Date(Math.min(Math.max(when, sentAt!.getTime() + 10 * MINUTE), now.getTime() - MINUTE));
      };
      const pay = (amount: number, when: Date) => {
        payments.push({
          organizationId: orgId,
          invoiceId: d.id,
          amountMinor: amount,
          currency: spec.currency,
          method: f.helpers.arrayElement(methods),
          provider: "manual",
          reference: chance(0.6) ? `TRX-${f.string.numeric(8)}` : null,
          paidAt: when,
          recordedBy: officeUser(),
          createdAt: when,
        });
        paid += amount;
      };
      if (chance(pPaid)) {
        if (total > 100 && chance(0.12)) {
          const first = Math.floor(total / 2);
          pay(first, payDay(1, Math.min(age, 10)));
        }
        paidAt = payDay(paid ? Math.min(age, 11) : 0, Math.min(age, billing.paymentTermsDays + 12));
        pay(total - paid, paidAt);
        status = "paid";
      } else {
        if (pastDue && total > 100 && chance(0.25)) pay(Math.floor(total / 3), payDay(1, Math.min(age, 13)));
        status = pastDue ? "overdue" : "sent";
      }
      if (status === "overdue") {
        const late = dates.daysInclusive(dueDate, today) - 1;
        for (const stage of REMINDER_DAYS) {
          if (late < stage) break;
          reminders.push({
            organizationId: orgId,
            invoiceId: d.id,
            stage,
            sentAt: new Date(
              Math.min(at(dates.addDays(dueDate, stage), 8 * 60 + 5, tz).getTime(), now.getTime() - MINUTE),
            ),
          });
        }
      }
      if (!voided && status === "sent" && paid === 0 && age > 3 && d.id !== demoInvoice && chance(0.3)) {
        status = "void";
        voided = true;
        voidedAt = new Date(
          Math.min(
            now.getTime() - MINUTE,
            sentAt.getTime() + f.number.int({ min: 2, max: 48 }) * 60 * MINUTE,
          ),
        );
      }
      events.push({
        organizationId: orgId,
        jobId: d.job.id,
        type: "invoiced",
        fromStatus: null,
        toStatus: null,
        actorUserId: owner.userId,
        payload: { invoice_id: d.id, invoice_number: number, total_minor: total, currency: spec.currency },
        createdAt: sentAt,
      });
    }
    const contactId = billTo.get(d.job.customerId) ?? null;
    invoiceRows.push({
      id: d.id,
      organizationId: orgId,
      number,
      customerId: d.job.customerId,
      siteId: d.job.siteId,
      jobId: d.job.id,
      quoteId: quoteByJob.get(d.job.id) ?? null,
      contactId,
      status,
      currency: spec.currency,
      discountType: d.discount.type,
      discountValue: d.discount.value,
      subtotalMinor: d.totals.subtotalMinor,
      discountMinor: d.totals.discountMinor,
      taxMinor: d.totals.taxMinor,
      totalMinor: total,
      amountPaidMinor: paid,
      issueDate: d.issueDate,
      dueDate,
      sentAt,
      paidAt,
      voidedAt,
      voidReason: voidedAt ? text.voidReason : null,
      createdBy: officeUser(),
      createdAt: d.createdAt,
      updatedAt: voidedAt ?? paidAt ?? sentAt ?? d.createdAt,
    });
    d.lines.forEach((l, i) =>
      invoiceLines.push({
        organizationId: orgId,
        invoiceId: d.id,
        position: i,
        kind: l.kind,
        catalogItemId: l.catalogItemId,
        serviceTypeId: l.serviceTypeId,
        expenseRequestId: l.expenseRequestId ?? null,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitCostMinor: l.unitCostMinor ?? null,
        markupBps: l.markupBps ?? 0,
        unitPriceMinor: l.unitPriceMinor,
        taxRateBps: l.taxRateBps,
        netMinor: d.totals.lines[i]!.netMinor,
        taxMinor: d.totals.lines[i]!.taxMinor,
        createdAt: d.createdAt,
      }),
    );
  }

  await insertBatches(tx, s.invoice, invoiceRows);
  await insertBatches(tx, s.invoiceLine, invoiceLines);
  await insertBatches(tx, s.payment, payments);
  await insertBatches(tx, s.invoiceReminder, reminders);
  await insertBatches(tx, s.jobEvent, events);
  const counters = [
    ...[...quoteCounters].map(([year, value]) => ({ organizationId: orgId, name: `quote:${year}`, value })),
    ...[...invoiceCounters].map(([year, value]) => ({
      organizationId: orgId,
      name: `invoice:${year}`,
      value,
    })),
  ];
  if (counters.length) await tx.insert(s.orgCounter).values(counters);
}
