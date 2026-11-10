// Intake evaluation (AI-01, PRD §9.2): runs the 40 messages in evals/intake.jsonl through the real model and checks
// the PRD thresholds: service type ≥ 90% correct, priority ≥ 80% exact and ≥ 95% within one level, p95 latency
// under 6 seconds. Each run calls the Claude API 40 times (about $1), so it runs on demand, never in `pnpm verify`.
//   ANTHROPIC_API_KEY=… pnpm --filter @fieldops/ai eval:intake
//   AI_PROVIDER=fixture pnpm --filter @fieldops/ai eval:intake    # the keyword baseline, free
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IntakeCatalog } from "@fieldops/core";
import { JOB_PRIORITIES, type JobPriority } from "@fieldops/shared";
import { createIntakeModel } from "./index";

interface Case {
  id: string;
  org: "acme-air" | "acme-teknik";
  message: string;
  expected: { service_type: string | null; priority: JobPriority };
}

const svc = (n: number, name: string, defaultDurationMin: number, requiredSkills: string[]) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name,
  description: null,
  defaultDurationMin,
  requiredSkills,
});

// The demo organizations' catalogs (packages/db/src/seed/data.ts).
const CATALOGS: Record<Case["org"], IntakeCatalog> = {
  "acme-air": {
    organizationName: "Acme Air & Clean",
    country: "US",
    currency: "USD",
    serviceTypes: [
      svc(1, "AC tune-up", 90, ["ac"]),
      svc(2, "AC repair", 120, ["ac"]),
      svc(3, "AC installation", 240, ["install"]),
      svc(4, "Refrigerant recharge", 60, ["refrigerant"]),
      svc(5, "Duct cleaning", 180, ["duct"]),
      svc(6, "Commercial cleaning", 240, ["cleaning"]),
      svc(7, "Deep cleaning", 180, ["cleaning"]),
      svc(8, "Filter replacement", 30, ["ac"]),
    ],
    skills: ["ac", "cleaning", "duct", "electrical", "install", "refrigerant"],
  },
  "acme-teknik": {
    organizationName: "Acme Teknik Nusantara",
    country: "ID",
    currency: "IDR",
    serviceTypes: [
      svc(11, "Cuci AC", 60, ["ac"]),
      svc(12, "Perbaikan AC", 120, ["ac"]),
      svc(13, "Pasang AC baru", 180, ["install"]),
      svc(14, "Isi freon", 60, ["refrigerant"]),
      svc(15, "Bongkar pasang AC", 240, ["install"]),
      svc(16, "Perawatan gedung", 480, ["ac"]),
    ],
    skills: ["ac", "electrical", "install", "refrigerant"],
  },
};

const THRESHOLDS = { serviceType: 0.9, priorityExact: 0.8, priorityWithinOne: 0.95, p95LatencyMs: 6000 };
// Claude Opus 5.5 list prices per million tokens (§9.7).
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

async function main() {
  const env = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    provider: process.env.AI_PROVIDER,
    intakeModel: process.env.AI_MODEL_INTAKE,
  };
  const model = createIntakeModel(env);
  if (model.provider === "unavailable") {
    console.log(
      "Set ANTHROPIC_API_KEY to run the intake evaluation (40 calls, about $1), or AI_PROVIDER=fixture.",
    );
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const cases: Case[] = readFileSync(join(here, "../evals/intake.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Case);

  const results: {
    c: Case;
    serviceType: string | null;
    priority: JobPriority | null;
    ms: number;
    ok: boolean;
  }[] = [];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const queue = [...cases];
  // Four at a time keeps the run short without tripping rate limits.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const catalog = CATALOGS[c.org];
        const r = await model.draft({ message: c.message, photos: [], catalog });
        tokens.input += r.usage.inputTokens;
        tokens.output += r.usage.outputTokens;
        tokens.cacheRead += r.usage.cacheReadTokens;
        tokens.cacheWrite += r.usage.cacheWriteTokens;
        const out =
          r.kind === "draft" ? (r.output as { service_type_id: string | null; priority: JobPriority }) : null;
        const serviceType = catalog.serviceTypes.find((t) => t.id === out?.service_type_id)?.name ?? null;
        results.push({
          c,
          serviceType,
          priority: out?.priority ?? null,
          ms: r.latencyMs,
          ok: r.kind === "draft",
        });
      }
    }),
  );

  const rank = (p: JobPriority | null) => (p ? JOB_PRIORITIES.indexOf(p) : -10);
  const share = (f: (r: (typeof results)[number]) => boolean) => results.filter(f).length / results.length;
  const metrics = {
    serviceType: share((r) => r.serviceType === r.c.expected.service_type),
    priorityExact: share((r) => r.priority === r.c.expected.priority),
    priorityWithinOne: share((r) => Math.abs(rank(r.priority) - rank(r.c.expected.priority)) <= 1),
    p95LatencyMs:
      [...results.map((r) => r.ms)].sort((a, b) => a - b)[Math.ceil(results.length * 0.95) - 1] ?? 0,
  };
  const cost =
    (tokens.input * PRICE.input +
      tokens.output * PRICE.output +
      tokens.cacheRead * PRICE.cacheRead +
      tokens.cacheWrite * PRICE.cacheWrite) /
    1e6;

  for (const r of results.sort((a, b) => a.c.id.localeCompare(b.c.id))) {
    const st = r.serviceType === r.c.expected.service_type ? "✓" : `✗ ${r.serviceType ?? "none"}`;
    const pr = r.priority === r.c.expected.priority ? "✓" : `✗ ${r.priority ?? "none"}`;
    console.log(
      `${r.c.id}  service ${st.padEnd(24)} priority ${pr.padEnd(10)} ${Math.round(r.ms)} ms${r.ok ? "" : "  (no draft)"}`,
    );
  }
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const pass = {
    serviceType: metrics.serviceType >= THRESHOLDS.serviceType,
    priorityExact: metrics.priorityExact >= THRESHOLDS.priorityExact,
    priorityWithinOne: metrics.priorityWithinOne >= THRESHOLDS.priorityWithinOne,
    p95LatencyMs: metrics.p95LatencyMs < THRESHOLDS.p95LatencyMs,
  };
  console.log(`\nModel: ${model.model} (${model.provider}), ${results.length} messages`);
  console.log(
    `Service type correct:  ${pct(metrics.serviceType)} (≥ 90%) ${pass.serviceType ? "pass" : "FAIL"}`,
  );
  console.log(
    `Priority exact:        ${pct(metrics.priorityExact)} (≥ 80%) ${pass.priorityExact ? "pass" : "FAIL"}`,
  );
  console.log(
    `Priority within one:   ${pct(metrics.priorityWithinOne)} (≥ 95%) ${pass.priorityWithinOne ? "pass" : "FAIL"}`,
  );
  console.log(
    `p95 latency:           ${Math.round(metrics.p95LatencyMs)} ms (< 6000) ${pass.p95LatencyMs ? "pass" : "FAIL"}`,
  );
  if (model.provider === "anthropic") {
    console.log(
      `Tokens: ${tokens.input} in, ${tokens.output} out, ${tokens.cacheRead} cache read; about $${cost.toFixed(2)}`,
    );
  }
  if (!Object.values(pass).every(Boolean)) process.exitCode = 1;
}

await main();
