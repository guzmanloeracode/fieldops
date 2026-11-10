import type { IntakeCatalog, IntakeModel, IntakeModelInput, IntakeModelResult } from "@fieldops/core";
import type { IntakeModelOutput, JobPriority } from "@fieldops/shared";

// TEST DOUBLE. A deterministic, keyword-based stand-in for the intake model, used by the E2E suite and local
// development (AI_PROVIDER=fixture). It never calls a model: it matches words in the message to the catalog,
// so the same message always gives the same draft. Messages containing "[[refuse]]" or "[[fail]]" return a
// refusal or an error, to exercise the fallback to the manual form.

type Lang = "en" | "id";

/** Words in a message → words in a service type's name. Checked in order; the first match wins. */
const SERVICE_RULES: { message: RegExp; name: RegExp; checks: Record<Lang, string[]> }[] = [
  {
    message: /\b(install|new unit|replace the unit|pasang|unit baru)\b/i,
    name: /install|pasang/i,
    checks: { en: ["Confirm the circuit breaker size"], id: ["Pastikan daya listrik cukup"] },
  },
  {
    message: /\b(refrigerant|freon|recharge|isi freon)\b/i,
    name: /refrigerant|freon/i,
    checks: { en: ["Check for oil stains at the joints"], id: ["Periksa bekas oli di sambungan pipa"] },
  },
  {
    message: /\b(duct|ducts|vent|vents)\b/i,
    name: /duct/i,
    checks: { en: ["Check airflow at every vent"], id: ["Periksa aliran udara di tiap kisi"] },
  },
  {
    message: /\b(filter|filters)\b/i,
    name: /filter/i,
    checks: { en: ["Note the filter size"], id: ["Catat ukuran filter"] },
  },
  {
    message: /\b(office|commercial|kantor|gedung)\b.*\b(clean|cleaning|bersih)/i,
    name: /commercial|gedung/i,
    checks: { en: ["Confirm after-hours access"], id: ["Konfirmasi akses di luar jam kerja"] },
  },
  {
    message:
      /\b(leak|leaking|drip|dripping|not cold|not cooling|warm air|noise|noisy|broken|bocor|netes|menetes|tidak dingin|berisik|rusak|mati)\b/i,
    name: /repair|perbaikan/i,
    checks: {
      en: ["Check the condensate drain line", "Measure supply and return temperatures"],
      id: ["Periksa saluran pembuangan air", "Ukur suhu udara keluar"],
    },
  },
  {
    message: /\b(clean|cleaning|deep clean|cuci|bersih)\b/i,
    name: /clean|cuci/i,
    checks: { en: [], id: [] },
  },
  {
    message: /\b(maintenance|tune-up|tune up|service|annual|perawatan|servis|rutin)\b/i,
    name: /tune|perawatan|cuci/i,
    checks: { en: [], id: [] },
  },
];

const URGENT =
  /\b(urgent|emergency|asap|right now|server room|elderly|baby|infant|sparks?|burning|smoke|darurat|segera|lansia|bayi|percikan|terbakar|ruang server)\b/i;
const HIGH = /\b(leak|leaking|not cold|not cooling|no cooling|today|bocor|tidak dingin|hari ini)\b/i;
const LOW = /\b(quote|maintenance|routine|annual|clean|cleaning|penawaran|perawatan|rutin|cuci)\b/i;
const INDONESIAN = /\b(tidak|saya|yang|mohon|tolong|rumah|dan|di|sejak|kami|bisa)\b/gi;

const REASONS: Record<Lang, Record<JobPriority, string>> = {
  en: {
    urgent: "The customer describes a safety risk or people at risk.",
    high: "The equipment is failing and the customer is affected today.",
    normal: "A fault that can wait for the next open slot.",
    low: "Routine work with no fault reported.",
  },
  id: {
    urgent: "Pelanggan menyebut risiko keselamatan atau penghuni berisiko.",
    high: "Peralatan bermasalah dan pelanggan terdampak hari ini.",
    normal: "Gangguan yang bisa menunggu jadwal berikutnya.",
    low: "Pekerjaan rutin tanpa laporan kerusakan.",
  },
};

const QUESTIONS: Record<Lang, { address: string; phone: string; model: string }> = {
  en: {
    address: "What's the service address?",
    phone: "What's the best phone number to reach you?",
    model: "Do you know the unit's brand or model?",
  },
  id: {
    address: "Di mana alamat lokasinya?",
    phone: "Nomor telepon yang bisa dihubungi?",
    model: "Apakah tahu merek atau tipe unitnya?",
  },
};

const BRANDS =
  /\b(Carrier|Trane|Lennox|Daikin|Rheem|Goodman|Panasonic|LG|Samsung|Sharp|Gree|Mitsubishi|Polytron)\b/i;

function match(re: RegExp, text: string): string | null {
  const m = re.exec(text);
  return m ? (m[1] ?? m[0]).trim() : null;
}

/** The deterministic draft for a message; exported for tests and the eval baseline. */
export function fixtureDraft(message: string, catalog: IntakeCatalog, photoCount = 0): IntakeModelOutput {
  const lang: Lang = (message.match(INDONESIAN)?.length ?? 0) >= 2 ? "id" : "en";
  const rule = SERVICE_RULES.find((r) => r.message.test(message));
  const serviceType = rule ? (catalog.serviceTypes.find((t) => rule.name.test(t.name)) ?? null) : null;
  const priority: JobPriority = URGENT.test(message)
    ? "urgent"
    : HIGH.test(message)
      ? "high"
      : LOW.test(message)
        ? "low"
        : "normal";
  const email = match(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/, message);
  const phone = match(/(\+?\(?\d[\d\s().-]{7,}\d)/, message);
  const name = match(
    /(?:[Mm]y name is|[Tt]his is|[Nn]ama saya|[Ss]aya)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/,
    message,
  );
  const address = match(/(?:address|alamat)\s*:?\s*([^\n.]+)/i, message);
  const brand = match(BRANDS, message);
  const firstSentence = message.split(/[.!?\n]/)[0]!.trim();
  const title = firstSentence.length > 80 ? `${firstSentence.slice(0, 77).trim()}…` : firstSentence;
  const questions = [
    ...(address ? [] : [QUESTIONS[lang].address]),
    ...(phone || email ? [] : [QUESTIONS[lang].phone]),
    ...(brand || photoCount ? [] : [QUESTIONS[lang].model]),
  ];
  return {
    language: lang,
    title: title || (lang === "en" ? "Service request" : "Permintaan servis"),
    service_type_id: serviceType?.id ?? null,
    priority,
    priority_reason: REASONS[lang][priority],
    summary: message.length > 400 ? `${message.slice(0, 397)}…` : message,
    checklist: rule?.checks[lang] ?? [],
    estimated_duration_min: serviceType ? serviceType.defaultDurationMin : null,
    equipment: { type: serviceType ? (lang === "en" ? "Air conditioner" : "AC") : null, brand, model: null },
    contact: { name, phone, email, address },
    questions,
    confidence: {
      title: title ? 0.8 : 0.3,
      service_type: serviceType ? 0.9 : 0.2,
      priority: priority === "normal" ? 0.5 : 0.85,
      summary: 0.9,
      estimated_duration: serviceType ? 0.7 : 0.3,
      equipment: brand ? 0.8 : 0.3,
      contact: name || phone || email ? 0.9 : 0.2,
    },
  };
}

export class FixtureIntakeModel implements IntakeModel {
  readonly provider = "fixture" as const;
  readonly model = "fixture-intake";

  async draft(input: IntakeModelInput): Promise<IntakeModelResult> {
    const tokens = Math.ceil(input.message.length / 4);
    const info = {
      model: this.model,
      usage: { inputTokens: 1500 + tokens, outputTokens: 300, cacheReadTokens: 1400, cacheWriteTokens: 0 },
      latencyMs: 40 + input.photos.length * 10,
    };
    if (input.message.includes("[[refuse]]"))
      return { kind: "refused", ...info, stopReason: "refusal", error: null };
    if (input.message.includes("[[fail]]"))
      return { kind: "failed", ...info, stopReason: null, error: "Fixture failure" };
    return {
      kind: "draft",
      ...info,
      stopReason: "end_turn",
      output: fixtureDraft(input.message, input.catalog, input.photos.length),
    };
  }
}
