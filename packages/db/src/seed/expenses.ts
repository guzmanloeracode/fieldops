import { DEFAULT_APPROVAL_THRESHOLDS } from "@fieldops/shared";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { insertBatches } from "./time";

/** A catalog line: price in major units, a typical quantity range and why it's needed. */
interface CatalogItem {
  kind: "part" | "expense";
  item: string;
  price: number;
  qty: [number, number];
  /** Quantities in steps of 0.5 (refrigerant by weight). */
  half?: boolean;
  reasons: string[];
}

const USD: CatalogItem[] = [
  {
    kind: "part",
    item: "Condensate drain pump",
    price: 45,
    qty: [1, 1],
    reasons: ["Pump seized, water backing up into the pan", "Old pump is noisy and leaking"],
  },
  {
    kind: "part",
    item: "Run capacitor 45/5 µF",
    price: 18.5,
    qty: [1, 1],
    reasons: ["Capacitor tested 30% under rating", "Bulging capacitor, compressor struggling to start"],
  },
  {
    kind: "part",
    item: "Contactor 30A 2-pole",
    price: 32,
    qty: [1, 1],
    reasons: ["Pitted contacts, unit chattering", "Contactor stuck closed"],
  },
  {
    kind: "part",
    item: "Refrigerant R-410A (lb)",
    price: 28,
    qty: [2, 5],
    half: true,
    reasons: ["System low on charge after leak repair", "Top-up after replacing the service valve core"],
  },
  {
    kind: "part",
    item: "Air filter 16×25×1 (MERV 11)",
    price: 12,
    qty: [2, 6],
    reasons: ["Customer asked for spares", "Filters clogged, replaced on every return"],
  },
  {
    kind: "part",
    item: "Condensate pump with safety switch",
    price: 129,
    qty: [1, 1],
    reasons: ["Existing pump has no overflow switch", "Pump failed, ceiling stain below the unit"],
  },
  {
    kind: "part",
    item: "Blower motor 1/2 HP",
    price: 289,
    qty: [1, 1],
    reasons: ["Motor bearings worn, overheating", "Blower motor dead, no airflow"],
  },
  {
    kind: "part",
    item: "Programmable thermostat",
    price: 85,
    qty: [1, 1],
    reasons: ["Old thermostat blank, customer approved replacement", "Thermostat reading 6 °F off"],
  },
  {
    kind: "part",
    item: "Condenser fan motor",
    price: 165,
    qty: [1, 1],
    reasons: ["Fan motor not spinning, compressor tripping on heat", "Seized fan motor"],
  },
  { kind: "part", item: "TXV valve", price: 210, qty: [1, 1], reasons: ["Superheat high, TXV stuck closed"] },
  {
    kind: "part",
    item: "Duct tape and mastic",
    price: 22,
    qty: [1, 2],
    reasons: ["Sealing leaky joints in the attic"],
  },
  {
    kind: "expense",
    item: "Parking garage",
    price: 12,
    qty: [1, 1],
    reasons: ["No street parking downtown", "Building only allows garage parking"],
  },
  {
    kind: "expense",
    item: "Toll road",
    price: 6.5,
    qty: [1, 2],
    reasons: ["Fastest route between two calls"],
  },
  {
    kind: "expense",
    item: "Old unit disposal fee",
    price: 25,
    qty: [1, 1],
    reasons: ["Recycling center fee for the removed unit"],
  },
  {
    kind: "expense",
    item: "Vacuum pump rental",
    price: 60,
    qty: [1, 1],
    reasons: ["Shop pump is out for repair"],
  },
];

const IDR: CatalogItem[] = [
  {
    kind: "part",
    item: "Kapasitor AC 35 µF",
    price: 85_000,
    qty: [1, 1],
    reasons: ["Kapasitor lemah, kompresor susah start", "Kapasitor menggembung"],
  },
  {
    kind: "part",
    item: "Freon R32 (kg)",
    price: 180_000,
    qty: [1, 3],
    half: true,
    reasons: ["Tekanan freon rendah setelah perbaikan bocor", "Isi ulang freon"],
  },
  {
    kind: "part",
    item: "Pompa drain AC",
    price: 450_000,
    qty: [1, 1],
    reasons: ["Pompa drain mati, air menetes ke plafon"],
  },
  {
    kind: "part",
    item: "Filter udara AC split",
    price: 65_000,
    qty: [1, 4],
    reasons: ["Filter sobek", "Pelanggan minta cadangan"],
  },
  {
    kind: "part",
    item: "Remote AC universal",
    price: 120_000,
    qty: [1, 1],
    reasons: ["Remote pelanggan hilang"],
  },
  { kind: "part", item: "Kontaktor outdoor", price: 275_000, qty: [1, 1], reasons: ["Kontaktor gosong"] },
  {
    kind: "part",
    item: "Motor fan indoor",
    price: 850_000,
    qty: [1, 1],
    reasons: ["Motor fan berisik dan panas", "Motor fan mati"],
  },
  {
    kind: "part",
    item: "Kompresor 1 PK",
    price: 2_750_000,
    qty: [1, 1],
    reasons: ["Kompresor macet, sudah dicek arusnya"],
  },
  {
    kind: "part",
    item: "Pipa tembaga 1/4 + 3/8 (m)",
    price: 95_000,
    qty: [2, 5],
    reasons: ["Pipa lama bocor di sambungan", "Jarak indoor-outdoor lebih panjang"],
  },
  {
    kind: "expense",
    item: "Parkir gedung",
    price: 10_000,
    qty: [1, 1],
    reasons: ["Parkir gedung perkantoran"],
  },
  {
    kind: "expense",
    item: "Tol dalam kota",
    price: 15_500,
    qty: [1, 2],
    reasons: ["Jalur tercepat ke lokasi berikutnya"],
  },
  {
    kind: "expense",
    item: "Sewa tangga 5 m",
    price: 75_000,
    qty: [1, 1],
    reasons: ["Unit outdoor di lantai dua"],
  },
];

const SUPPLIERS = {
  "acme-air": ["Johnstone Supply", "Ferguson HVAC", "Lennox PartsPlus", "Home Depot"],
  "acme-teknik": ["Toko Sinar Teknik", "Glodok Elektrik", "Mitra AC Jaya"],
} as const;

const COMMENTS = {
  "acme-air": {
    approve: [
      "Approved.",
      "OK, go ahead.",
      "Approved. Use van stock first next time.",
      "Fine, customer agreed.",
    ],
    reject: [
      "We have this in the warehouse, pick it up there.",
      "Quote the customer first, then ask again.",
      "Too expensive from this supplier, use Johnstone.",
    ],
  },
  "acme-teknik": {
    approve: ["Disetujui.", "Oke, lanjut.", "Disetujui, pelanggan sudah setuju."],
    reject: ["Stok ada di gudang, ambil di sana.", "Minta penawaran ke pelanggan dulu."],
  },
} as const;

const MINUTE = 60_000;

interface Plan {
  job: SeedContext["jobs"][number];
  requesterMemberId: string;
  at: number;
  kind: "part" | "expense";
  /** "decide": a decision before `latest`; "pending": leave it waiting (unless auto-approved). */
  outcome: "decide" | "pending";
  /** Latest time for a decision or use (job completion, or now). */
  latest: number;
  /** The part may be recorded as used before `latest`. */
  usable: boolean;
  /** Prefer items above the auto-approve threshold. */
  expensive?: boolean;
}

/**
 * Parts and expense requests with decisions (EXP-01, EXP-02). About one in six finished jobs has a request;
 * small ones are auto-approved, larger ones decided by the owner or a dispatcher (within their limit), some
 * rejected, and approved parts recorded as used. Open jobs and upcoming visits get recent requests, some
 * still pending, so the approvals inbox has work. Nothing is dated after the reset time.
 */
export async function seedExpenses(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 3);
  const key = ctx.spec.key;
  const catalog = ctx.spec.currency === "IDR" ? IDR : USD;
  const limits = DEFAULT_APPROVAL_THRESHOLDS[ctx.spec.currency];
  const owner = ctx.members.find((m) => m.role === "owner")!;
  const approvers = ctx.members.filter(
    (m) => m.role === "owner" || m.role === "admin" || m.role === "dispatcher",
  );
  const chance = (p: number) => f.number.float({ min: 0, max: 1 }) < p;
  const now = ctx.now.getTime();
  const userOf = (memberId: string) => ctx.members.find((m) => m.id === memberId)?.userId ?? null;
  const leadOf = (job: Plan["job"]) => (job.assignees.find((a) => a.isLead) ?? job.assignees[0])?.memberId;
  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);

  const rows: (typeof s.expenseRequest.$inferInsert)[] = [];
  const events: (typeof s.jobEvent.$inferInsert)[] = [];

  function add(plan: Plan) {
    const pool = catalog.filter(
      (c) =>
        c.kind === plan.kind &&
        (!plan.expensive || Math.round(c.price * 100 * c.qty[1]) >= limits.autoApproveBelowMinor),
    );
    const c = f.helpers.arrayElement(pool.length ? pool : catalog.filter((x) => x.kind === plan.kind));
    let quantity = f.number.int({ min: c.qty[0], max: c.qty[1] });
    if (c.half && chance(0.4)) quantity += 0.5;
    const unitCostMinor = Math.round(c.price * 100);
    const totalMinor = Math.round(quantity * unitCostMinor);
    const requestedAt = new Date(plan.at);
    const id = uuidv7();
    const auto = totalMinor < limits.autoApproveBelowMinor;
    let status: "pending" | "approved" | "rejected" = auto ? "approved" : "pending";
    let decidedBy: string | null = null;
    let decidedAt: Date | null = auto ? requestedAt : null;
    let comment: string | null = null;
    let usedAt: Date | null = null;

    if (!auto && plan.outcome === "decide") {
      const allowed = approvers.filter(
        (a) => a.role !== "dispatcher" || totalMinor < limits.dispatcherLimitMinor,
      );
      const decider = f.helpers.arrayElement(allowed.length ? allowed : [owner]);
      const at = Math.min(plan.latest - MINUTE, plan.at + f.number.int({ min: 6, max: 140 }) * MINUTE);
      if (at > plan.at) {
        decidedAt = new Date(at);
        decidedBy = decider.id;
        status = chance(0.86) ? "approved" : "rejected";
        comment =
          status === "rejected"
            ? f.helpers.arrayElement(COMMENTS[key].reject)
            : chance(0.5)
              ? f.helpers.arrayElement(COMMENTS[key].approve)
              : null;
      }
    }
    if (
      status === "approved" &&
      c.kind === "part" &&
      decidedAt &&
      plan.usable &&
      plan.latest > decidedAt.getTime()
    ) {
      usedAt = new Date(
        Math.min(plan.latest, decidedAt.getTime() + f.number.int({ min: 5, max: 90 }) * MINUTE),
      );
    }

    rows.push({
      id,
      organizationId: ctx.orgId,
      jobId: plan.job.id,
      requesterMemberId: plan.requesterMemberId,
      kind: c.kind,
      item: c.item,
      quantity,
      unitCostMinor,
      totalMinor,
      currency: ctx.spec.currency,
      supplier: chance(0.85) ? f.helpers.arrayElement(SUPPLIERS[key]) : null,
      reason: f.helpers.arrayElement(c.reasons),
      status,
      autoApproved: auto,
      decidedByMemberId: decidedBy,
      decidedAt,
      decisionComment: comment,
      usedAt,
      createdAt: requestedAt,
      updatedAt: usedAt ?? decidedAt ?? requestedAt,
    });
    const base = { organizationId: ctx.orgId, jobId: plan.job.id, fromStatus: null, toStatus: null };
    events.push({
      ...base,
      type: "expense_requested",
      actorUserId: userOf(plan.requesterMemberId),
      payload: {
        expense_id: id,
        kind: c.kind,
        item: c.item,
        quantity,
        total_minor: totalMinor,
        currency: ctx.spec.currency,
        auto_approved: auto,
      },
      createdAt: requestedAt,
    });
    if (decidedBy && decidedAt) {
      events.push({
        ...base,
        type: "expense_decided",
        actorUserId: userOf(decidedBy),
        payload: {
          expense_id: id,
          item: c.item,
          decision: status,
          total_minor: totalMinor,
          currency: ctx.spec.currency,
          ...(comment ? { comment } : {}),
        },
        createdAt: decidedAt,
      });
    }
    if (usedAt) {
      events.push({
        ...base,
        type: "part_used",
        actorUserId: userOf(plan.requesterMemberId),
        payload: { expense_id: id, item: c.item, quantity },
        createdAt: usedAt,
      });
    }
  }

  const upcoming: Plan["job"][] = [];
  for (const job of ctx.jobs) {
    const lead = leadOf(job);
    if (!lead) continue;
    const started = time(job.events.find((e) => e.toStatus === "in_progress")?.createdAt);
    if (job.status === "completed" && started) {
      // History: decided before completion, never after the reset time.
      const end = Math.min(time(job.completedAt) ?? now, now);
      if (end - started < 30 * MINUTE || !chance(0.16)) continue;
      const count = chance(0.2) ? 2 : 1;
      for (let n = 0; n < count; n++) {
        add({
          job,
          requesterMemberId: lead,
          at: started + f.number.int({ min: 10, max: Math.floor((end - started) / MINUTE / 2) }) * MINUTE,
          kind: chance(0.8) ? "part" : "expense",
          outcome: "decide",
          latest: end,
          usable: true,
        });
      }
    } else if (
      (job.status === "in_progress" || job.status === "on_hold") &&
      started &&
      started < now - 30 * MINUTE
    ) {
      // Open work: a waiting-for-parts hold always has a request, made before the hold.
      const parts = job.status === "on_hold" && job.holdReason === "parts";
      if (!parts && !chance(0.6)) continue;
      const hold = time(job.events.find((e) => e.toStatus === "on_hold")?.createdAt);
      const until = Math.min(hold ?? now, now);
      add({
        job,
        requesterMemberId: lead,
        at:
          started +
          f.number.int({ min: 5, max: Math.max(6, Math.floor((until - started) / MINUTE) - 1) }) * MINUTE,
        kind: parts || chance(0.8) ? "part" : "expense",
        outcome: chance(0.5) ? "pending" : "decide",
        latest: now,
        usable: job.status === "in_progress",
        expensive: parts,
      });
    } else if (
      job.status === "scheduled" &&
      time(job.scheduledStart)! > now &&
      time(job.scheduledStart)! < now + 4 * 86_400_000
    ) {
      upcoming.push(job);
    }
  }

  // Parts ordered ahead for upcoming visits: requested since yesterday and still waiting for approval.
  const preorders = f.helpers.arrayElements(upcoming, Math.min(upcoming.length, key === "acme-air" ? 7 : 3));
  for (const job of preorders) {
    const created = time(job.createdAt) ?? now - 86_400_000;
    const at = Math.max(created + MINUTE, now - f.number.int({ min: 20, max: 30 * 60 }) * MINUTE);
    if (at >= now) continue;
    add({
      job,
      requesterMemberId: leadOf(job)!,
      at,
      kind: "part",
      outcome: "pending",
      latest: now,
      usable: false,
      expensive: true,
    });
  }

  await insertBatches(ctx.tx, s.expenseRequest, rows);
  await insertBatches(ctx.tx, s.jobEvent, events);
}
