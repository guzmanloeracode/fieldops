import type { ChecklistTemplateItem } from "@fieldops/shared";
import { eq, sql } from "drizzle-orm";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { insertBatches } from "./time";

/** Checklists, time entries and signatures (JOB-08, TEC-04, JOB-10). */

type T = ChecklistTemplateItem;
const box = (label: string, required = true): T => ({ label, kind: "checkbox", unit: null, required });
const num = (label: string, unit: string, required = true): T => ({ label, kind: "number", unit, required });
const text = (label: string, required = false): T => ({ label, kind: "text", unit: null, required });
const photo = (label: string, required = true): T => ({ label, kind: "photo", unit: null, required });

/** Checklist templates per demo service type (English for Acme Air, Bahasa Indonesia for Acme Teknik). */
export const TEMPLATES: Record<string, T[]> = {
  "AC tune-up": [
    box("Filters inspected and cleaned"),
    box("Condenser coil cleaned"),
    num("Suction pressure", "psi"),
    num("Supply air temperature", "°F"),
    box("Thermostat tested", false),
    photo("Photo of the unit after service"),
    text("Recommendations for the customer"),
  ],
  "AC repair": [
    text("Diagnosis", true),
    box("Electrical connections checked"),
    num("Compressor amperage", "A", false),
    num("Supply air temperature after repair", "°F"),
    box("Leak check done", false),
    photo("Photo of the repaired part"),
  ],
  "AC installation": [
    box("Unit level and secured"),
    num("Line set vacuum", "microns"),
    box("Electrical disconnect installed"),
    box("Condensate drain tested"),
    num("Supply air temperature", "°F"),
    photo("Photo of the finished installation"),
    box("Customer shown how to use the thermostat", false),
  ],
  "Refrigerant recharge": [
    box("Leak search performed"),
    num("Refrigerant added", "lb"),
    num("Suction pressure", "psi"),
    num("Superheat", "°F", false),
    photo("Photo of the gauges"),
  ],
  "Duct cleaning": [
    box("Registers removed and cleaned"),
    box("Main trunk vacuumed"),
    num("Vents cleaned", "vents"),
    photo("Photo of the ducts after cleaning"),
    text("Notes for the customer"),
  ],
  "Commercial cleaning": [
    box("Restrooms cleaned and restocked"),
    box("Floors vacuumed and mopped"),
    box("Trash removed"),
    num("Area cleaned", "sq ft", false),
    photo("Photo of the finished area"),
    text("Issues to report"),
  ],
  "Deep cleaning": [
    box("Kitchen degreased"),
    box("Bathrooms scrubbed"),
    box("Baseboards and vents wiped", false),
    num("Rooms cleaned", "rooms"),
    photo("Photo after cleaning"),
    text("Notes"),
  ],
  "Filter replacement": [
    text("Filter size", true),
    num("Filters replaced", "filters"),
    box("Airflow checked"),
    photo("Photo of the new filter", false),
  ],
  "Cuci AC": [
    box("Filter dicuci"),
    box("Evaporator disemprot"),
    box("Saluran pembuangan dicek"),
    num("Suhu udara keluar", "°C"),
    photo("Foto unit setelah dicuci"),
    text("Catatan untuk pelanggan"),
  ],
  "Perbaikan AC": [
    text("Diagnosis kerusakan", true),
    box("Kabel dan konektor dicek"),
    num("Arus kompresor", "A", false),
    num("Suhu udara keluar setelah perbaikan", "°C"),
    photo("Foto bagian yang diperbaiki"),
  ],
  "Pasang AC baru": [
    box("Bracket terpasang kuat"),
    num("Lama pemvakuman pipa", "menit"),
    box("Instalasi listrik aman"),
    box("Tes pembuangan air"),
    num("Suhu udara keluar", "°C"),
    photo("Foto hasil pemasangan"),
  ],
  "Isi freon": [
    box("Cek kebocoran"),
    num("Tekanan freon", "psi"),
    num("Freon ditambahkan", "kg", false),
    photo("Foto manometer"),
  ],
  "Bongkar pasang AC": [
    box("Freon di-pump down"),
    box("Unit dibongkar tanpa kerusakan"),
    box("Unit terpasang di lokasi baru"),
    num("Lama pemvakuman pipa", "menit"),
    photo("Foto hasil pemasangan"),
  ],
  "Perawatan gedung": [
    num("Jumlah unit diservis", "unit"),
    box("Filter semua unit dibersihkan"),
    text("Unit bermasalah"),
    num("Suhu rata-rata udara keluar", "°C"),
    photo("Foto ruang mesin"),
    text("Laporan untuk pengelola gedung"),
  ],
};

const FALLBACK: T[] = [box("Work done"), photo("Photo after the work"), text("Notes")];

/** Plausible readings per unit: [min, max, decimals]. */
const RANGES: Record<string, [number, number, number]> = {
  "°F": [52, 58, 1],
  "°C": [11, 16, 1],
  psi: [112, 138, 0],
  A: [4, 12, 1],
  lb: [0.5, 3, 1],
  microns: [300, 480, 0],
  kg: [0.3, 1.5, 1],
  menit: [15, 30, 0],
  vents: [6, 22, 0],
  "sq ft": [1500, 8000, 0],
  rooms: [3, 8, 0],
  filters: [1, 4, 0],
  unit: [4, 20, 0],
};

const NOTES_EN = [
  "Coil was dirty; cleaned and tested.",
  "All readings normal.",
  "Recommend replacing the capacitor at the next visit.",
  "Customer asked for a quote on a smart thermostat.",
  "Drain line partly clogged; flushed.",
  "16x25x1",
  "20x20x1",
];
const NOTES_ID = [
  "Evaporator kotor, sudah dibersihkan.",
  "Semua normal.",
  "Disarankan ganti kapasitor pada kunjungan berikutnya.",
  "Selang pembuangan tersumbat, sudah dibersihkan.",
  "Unit outdoor berkarat, perlu dicek ulang.",
];

export async function seedFieldwork(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 2);
  const { tx, orgId } = ctx;
  const english = ctx.spec.locale === "en";

  // Templates on the service types.
  const templates = new Map<string, T[]>();
  for (const st of ctx.serviceTypes) {
    const template = TEMPLATES[st.name] ?? FALLBACK;
    templates.set(st.id, template);
    await tx.update(s.serviceType).set({ checklistTemplate: template }).where(eq(s.serviceType.id, st.id));
  }

  // Acme Air asks for a customer signature on completion; Acme Teknik doesn't (JOB-10).
  if (ctx.spec.key === "acme-air") {
    await tx
      .update(s.organization)
      .set({ settings: sql`${s.organization.settings} || '{"require_signature": true}'::jsonb` })
      .where(eq(s.organization.id, orgId));
  }

  const memberByUser = new Map(ctx.members.map((m) => [m.userId, m]));
  const nowMs = ctx.now.getTime();
  const items: (typeof s.checklistItem.$inferInsert)[] = [];
  const entries: (typeof s.timeEntry.$inferInsert)[] = [];
  const events: (typeof s.jobEvent.$inferInsert)[] = [];

  const answer = (t: T): unknown => {
    if (t.kind === "checkbox") return true;
    if (t.kind === "photo") return null; // Seeded jobs have no photo files.
    if (t.kind === "text") return f.helpers.arrayElement(english ? NOTES_EN : NOTES_ID);
    const [min, max, digits] = RANGES[t.unit ?? ""] ?? [1, 10, 0];
    return f.number.float({ min, max, fractionDigits: digits });
  };

  for (const job of ctx.jobs) {
    const statusEvents = job.events
      .filter((e) => e.type === "status_changed")
      .sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
    const lead = job.assignees.find((a) => a.isLead) ?? job.assignees[0];

    // ---- time entries, the same way transitionJob records them
    const open = new Map<string, (typeof entries)[number]>(); // memberId → running entry
    const close = (at: Date, memberId?: string) => {
      for (const [m, e] of open) {
        if (memberId && m !== memberId) continue;
        e.endedAt = at;
        open.delete(m);
      }
    };
    for (const e of statusEvents) {
      const actor = e.actorUserId ? memberByUser.get(e.actorUserId) : undefined;
      const assigned = actor && job.assignees.some((a) => a.memberId === actor.id);
      const memberId = assigned ? actor.id : lead?.memberId;
      const transition = String((e.payload as Record<string, unknown> | undefined)?.transition ?? "");
      const at = e.createdAt!;
      const openKind = { depart: "travel", start: "work", resume: "work" }[transition];
      if (openKind) {
        if (!memberId) continue;
        close(at, memberId);
        const entry: (typeof entries)[number] = {
          organizationId: orgId,
          jobId: job.id,
          memberId,
          kind: openKind,
          startedAt: at,
          endedAt: null,
          source: "status",
          createdAt: at,
          updatedAt: at,
        };
        entries.push(entry);
        open.set(memberId, entry);
      } else if (["hold", "complete", "cancel", "unschedule"].includes(transition)) {
        close(at);
      }
    }

    // ---- checklist
    if (!job.serviceTypeId) continue;
    const template = templates.get(job.serviceTypeId) ?? [];
    if (!template.length) continue;
    const started = statusEvents.find((e) => e.toStatus === "in_progress")?.createdAt ?? null;
    const doer = lead ? ctx.members.find((m) => m.id === lead.memberId)?.userId : undefined;
    let doneCount = 0;
    let windowStart = 0;
    let windowEnd = 0;
    if (job.status === "completed" && started && job.completedAt) {
      doneCount = template.length;
      windowStart = started.getTime();
      windowEnd = (job.completedAt as Date).getTime();
    } else if ((job.status === "in_progress" || job.status === "on_hold") && started) {
      doneCount = f.number.int({ min: 1, max: Math.max(1, template.length - 2) });
      windowStart = started.getTime();
      const holdAt = statusEvents.find((e) => e.toStatus === "on_hold")?.createdAt?.getTime();
      windowEnd = Math.min(nowMs, holdAt ?? started.getTime() + 60 * 60_000);
      if (windowEnd <= windowStart) windowEnd = windowStart + 5 * 60_000;
    }
    let lastDone: Date | null = null;
    template.forEach((t, position) => {
      const done = position < doneCount;
      const doneAt = done
        ? new Date(windowStart + ((windowEnd - windowStart) * (position + 1)) / (template.length + 1))
        : null;
      if (doneAt) lastDone = doneAt;
      items.push({
        organizationId: orgId,
        jobId: job.id,
        position,
        label: t.label,
        kind: t.kind,
        unit: t.unit ?? null,
        required: t.required,
        value: done ? answer(t) : null,
        doneBy: done ? (doer ?? null) : null,
        doneAt,
        createdAt: job.createdAt,
      });
    });
    if (lastDone && doer) {
      events.push({
        organizationId: orgId,
        jobId: job.id,
        type: "checklist_updated",
        actorUserId: doer,
        payload: { items: template.slice(0, doneCount).map((t) => t.label), done: doneCount, cleared: 0 },
        createdAt: lastDone,
      });
    }
  }

  await insertBatches(tx, s.checklistItem, items);
  await insertBatches(tx, s.timeEntry, entries);
  await insertBatches(tx, s.jobEvent, events);
}
