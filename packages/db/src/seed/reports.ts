import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { DAY, insertBatches } from "./time";

// Service reports (AI-03) on the jobs completed in the last two months: most were sent to the customer, about two
// in three were drafted by the AI (some edited before sending) and the others written by hand; the latest ones are
// still drafts waiting to be sent. The text is built from each job's checklist answers and service type, never by
// a model, so the seed stays deterministic. Acme Teknik writes in Bahasa Indonesia. Offset 10.

const MODEL = "claude-opus-5-5";
const WINDOW_DAYS = 60;
/** Jobs completed this recently still have a draft report. */
const DRAFT_DAYS = 2;

type Lang = "en" | "id";

const TEXT = {
  en: {
    intro: {
      fault: [
        "The technician found the cause of the fault and repaired it.",
        "We diagnosed the problem on site and fixed it during the visit.",
        "The fault was traced and repaired, and the unit was tested afterwards.",
      ],
      planned: [
        "The technician completed the scheduled service.",
        "We carried out the planned work and tested everything before leaving.",
        "The service was completed as planned.",
      ],
    },
    checks: (list: string) => `Checks carried out: ${list}.`,
    readings: (list: string) => `Readings: ${list}.`,
    findings: {
      fault: [
        "The drain line was partly clogged, which caused the leak.",
        "A worn capacitor was making the outdoor unit start slowly.",
        "The refrigerant charge was slightly low; no leak was found at the joints.",
        "The fan motor bearings were noisy and worn.",
      ],
      planned: [
        "The equipment is in good condition.",
        "The filters were dirty but the coils were clean.",
        "Everything was working normally; minor dust build-up was cleaned.",
      ],
    },
    added: ["We showed the customer how to clean the filter.", "The customer was happy with the result."],
    recommendations: [
      "Replace the air filter every three months.",
      "Keep the area around the outdoor unit clear of leaves.",
      "Plan a capacitor replacement at the next visit.",
      "Book a maintenance visit before the hot season.",
    ],
  },
  id: {
    intro: {
      fault: [
        "Teknisi menemukan penyebab gangguan dan sudah memperbaikinya.",
        "Masalah sudah diperiksa di lokasi dan diperbaiki saat kunjungan.",
        "Kerusakan sudah ditelusuri dan diperbaiki, lalu unit diuji kembali.",
      ],
      planned: [
        "Teknisi telah menyelesaikan servis sesuai jadwal.",
        "Pekerjaan terencana sudah dilakukan dan semuanya diuji sebelum selesai.",
        "Servis sudah selesai sesuai rencana.",
      ],
    },
    checks: (list: string) => `Pemeriksaan yang dilakukan: ${list}.`,
    readings: (list: string) => `Hasil pengukuran: ${list}.`,
    findings: {
      fault: [
        "Selang pembuangan tersumbat sebagian sehingga air menetes.",
        "Kapasitor sudah lemah sehingga unit outdoor lambat menyala.",
        "Tekanan freon sedikit kurang; tidak ditemukan kebocoran di sambungan.",
        "Bearing motor kipas aus dan berisik.",
      ],
      planned: [
        "Peralatan dalam kondisi baik.",
        "Filter kotor, tetapi evaporator masih bersih.",
        "Semua berfungsi normal; debu ringan sudah dibersihkan.",
      ],
    },
    added: ["Pelanggan sudah diajari cara membersihkan filter.", "Pelanggan puas dengan hasilnya."],
    recommendations: [
      "Bersihkan filter udara setiap tiga bulan.",
      "Jaga area di sekitar unit outdoor tetap bersih dari daun.",
      "Rencanakan penggantian kapasitor pada kunjungan berikutnya.",
      "Jadwalkan perawatan sebelum musim panas.",
    ],
  },
} satisfies Record<Lang, unknown>;

/** YYYY-MM-DD of an instant in a time zone. */
function localIso(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export async function seedReports(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 10);
  const { tx, orgId } = ctx;
  const lang: Lang = ctx.spec.locale;
  const t = TEXT[lang];
  const nowMs = ctx.now.getTime();
  const recent = ctx.jobs
    .filter(
      (j) =>
        j.status === "completed" &&
        j.completedAt instanceof Date &&
        nowMs - j.completedAt.getTime() <= WINDOW_DAYS * DAY &&
        j.completedAt.getTime() <= nowMs,
    )
    .sort((a, b) => a.number - b.number);
  if (!recent.length) return;
  const jobIds = recent.map((j) => j.id);

  const [items, contacts] = await Promise.all([
    tx
      .select({
        jobId: s.checklistItem.jobId,
        label: s.checklistItem.label,
        kind: s.checklistItem.kind,
        unit: s.checklistItem.unit,
        value: s.checklistItem.value,
        doneAt: s.checklistItem.doneAt,
      })
      .from(s.checklistItem)
      .where(and(eq(s.checklistItem.organizationId, orgId), inArray(s.checklistItem.jobId, jobIds)))
      .orderBy(asc(s.checklistItem.jobId), asc(s.checklistItem.position)),
    tx
      .select({ customerId: s.contact.customerId, email: s.contact.email })
      .from(s.contact)
      .where(eq(s.contact.organizationId, orgId))
      .orderBy(asc(s.contact.customerId), desc(s.contact.isPrimary), asc(s.contact.name)),
  ]);
  const emailOf = new Map<string, string>();
  for (const c of contacts) if (c.email && !emailOf.has(c.customerId)) emailOf.set(c.customerId, c.email);
  const office = ctx.members.filter((m) => m.role === "dispatcher" || m.role === "owner");
  const userOf = new Map(ctx.members.map((m) => [m.id, m.userId]));
  const fault = new Map(ctx.serviceTypes.map((st) => [st.id, Boolean(st.spec.fault)]));
  const number = new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 2 });

  const reports: (typeof s.serviceReport.$inferInsert)[] = [];
  const calls: (typeof s.aiInteraction.$inferInsert)[] = [];
  const events: (typeof s.jobEvent.$inferInsert)[] = [];

  for (const job of recent) {
    const completedAt = job.completedAt as Date;
    const isFault = job.serviceTypeId ? (fault.get(job.serviceTypeId) ?? false) : false;
    const kind = isFault ? "fault" : "planned";
    const own = items.filter((i) => i.jobId === job.id && i.doneAt);
    const checks = own.filter((i) => i.kind === "checkbox").map((i) => i.label);
    const readings = own
      .filter((i) => (i.kind === "number" && typeof i.value === "number") || (i.kind === "text" && i.value))
      .map((i) =>
        typeof i.value === "number"
          ? `${i.label}: ${number.format(i.value)}${i.unit ? ` ${i.unit}` : ""}`
          : `${i.label}: ${String(i.value).replace(/[.\s]+$/, "")}`,
      );
    const work = [
      f.helpers.arrayElement(t.intro[kind]),
      checks.length ? t.checks(checks.join("; ")) : null,
      readings.length ? t.readings(readings.join("; ")) : null,
    ]
      .filter(Boolean)
      .join(" ");
    const completedOn = localIso(completedAt, ctx.timeZone);
    const draft = {
      workPerformed: work,
      findings: f.helpers.arrayElement(t.findings[kind]),
      recommendations:
        f.number.float({ min: 0, max: 1 }) < 0.75 ? f.helpers.arrayElement(t.recommendations) : null,
      nextServiceDate: addMonths(completedOn, isFault ? 3 : 6),
    };

    // About two in three: each AI draft counts against the monthly quota the demo visitors share.
    const ai = f.number.float({ min: 0, max: 1 }) < 0.65;
    const edited = !ai || f.number.float({ min: 0, max: 1 }) < 0.3;
    const to = emailOf.get(job.customerId) ?? null;
    const sent =
      to !== null &&
      nowMs - completedAt.getTime() > DRAFT_DAYS * DAY &&
      f.number.float({ min: 0, max: 1 }) < 0.9;
    const lead = job.assignees.find((a) => a.isLead) ?? job.assignees[0];
    const editor = f.helpers.arrayElement([
      ...office.map((m) => m.userId),
      ...(lead ? [userOf.get(lead.memberId)!] : []),
    ]);
    // A person who edited an AI draft added a sentence of their own.
    const final =
      edited && ai
        ? { ...draft, workPerformed: `${draft.workPerformed} ${f.helpers.arrayElement(t.added)}` }
        : draft;
    const draftedAt = new Date(completedAt.getTime() + f.number.int({ min: 1, max: 4 }) * 60_000);
    const sentAt = sent
      ? new Date(
          Math.min(nowMs - 60_000, completedAt.getTime() + f.number.int({ min: 20, max: 26 * 60 }) * 60_000),
        )
      : null;

    const reportId = uuidv7();
    let interactionId: string | null = null;
    if (ai) {
      interactionId = uuidv7();
      calls.push({
        id: interactionId,
        organizationId: orgId,
        userId: null,
        jobId: job.id,
        feature: "report",
        model: MODEL,
        inputTokens: f.number.int({ min: 1400, max: 2300 }),
        outputTokens: f.number.int({ min: 220, max: 480 }),
        cacheReadTokens: f.number.int({ min: 500, max: 700 }),
        cacheWriteTokens: 0,
        latencyMs: f.number.int({ min: 4200, max: 11_000 }),
        stopReason: "end_turn",
        outcome: sent ? (edited ? "edited" : "accepted") : "drafted",
        output: draft,
        error: null,
        createdAt: draftedAt,
        updatedAt: sentAt ?? draftedAt,
      });
    }
    reports.push({
      id: reportId,
      organizationId: orgId,
      jobId: job.id,
      status: sent ? "sent" : "draft",
      locale: lang,
      ...final,
      aiStatus: ai ? "drafted" : "skipped",
      aiInteractionId: interactionId,
      aiDrafted: ai,
      editedBy: edited ? editor : null,
      sentAt,
      sentTo: sent ? to : null,
      sentBy: sent ? editor : null,
      version: 1 + (ai ? 1 : 0) + (edited ? 1 : 0) + (sent ? 1 : 0),
      createdAt: completedAt,
      updatedAt: sentAt ?? draftedAt,
    });
    if (sentAt) {
      events.push({
        organizationId: orgId,
        jobId: job.id,
        type: "report_sent",
        actorUserId: editor,
        payload: { report_id: reportId, to },
        createdAt: sentAt,
      });
    }
  }

  await insertBatches(tx, s.aiInteraction, calls);
  await insertBatches(tx, s.serviceReport, reports);
  await insertBatches(tx, s.jobEvent, events);
}
