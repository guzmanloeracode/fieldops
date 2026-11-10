// Ask FieldOps evaluation (AI-02, PRD §9.3): runs the 25 questions in evals/assistant.jsonl against a seeded demo
// database and checks both the tools the model chose and the numbers and records in its answers. Expected values
// are computed from the database when the eval runs (never hard-coded), so the set follows the seed's reset time.
// Each run makes about 25 assistant calls with tool loops (roughly $1–2), so it runs on demand, never in
// `pnpm verify`. Nothing is written: the tools run read-only and no conversation is saved.
//   DATABASE_URL=<owner URL of a seeded demo database> ANTHROPIC_API_KEY=… pnpm eval:assistant
//   DATABASE_URL=… AI_PROVIDER=fixture pnpm eval:assistant      # the keyword baseline, free
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assistant,
  assistantTools,
  availability,
  formatJobNumber,
  formatMoney,
  money,
  type Actor,
  type AssistantModelResult,
  type ServiceContext,
  type TxRunner,
} from "@fieldops/core";
import { createDb, withStore } from "@fieldops/db";
import {
  ASSISTANT_MAX_TOOL_CALLS,
  DEFAULT_APPROVAL_THRESHOLDS,
  type AssistantToolName,
  type Currency,
  type Role,
} from "@fieldops/shared";
import { createAssistantModel } from "./index";

type Org = "acme-air" | "acme-teknik";
type As = "owner" | "admin" | "dispatcher" | "technician";
type Match = "number" | "all" | "none" | "text" | "phrase";

interface Check {
  /** A named query below; its result is what the answer must contain (or must not, for "none"). */
  oracle?: string;
  args?: (string | number)[];
  match: Match;
  /** For "phrase": any of these words or phrases. */
  values?: string[];
}

interface Case {
  id: string;
  org: Org;
  as: As;
  question: string;
  /** Tools the answer needs; every one must be called. An empty list means none should be. */
  tools: AssistantToolName[];
  checks: Check[];
}

/** The demo accounts (packages/db/src/seed/data.ts). */
const USERS: Record<Org, Record<As, string>> = {
  "acme-air": {
    owner: "olivia@acme-air.example",
    admin: "marcus@acme-air.example",
    dispatcher: "dan@acme-air.example",
    technician: "tom@acme-air.example",
  },
  "acme-teknik": {
    owner: "siti@acme-teknik.example",
    admin: "olivia@acme-air.example",
    dispatcher: "budi@acme-teknik.example",
    technician: "rizky@acme-teknik.example",
  },
};

const THRESHOLDS = { tools: 0.9, checks: 0.85 };
// Claude Opus 5.5 list prices per million tokens (§9.7).
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

interface OrgInfo {
  id: string;
  name: string;
  timezone: string;
  currency: Currency;
  today: string;
  dispatcherLimitMinor: number;
}

interface OracleCtx {
  pool: ReturnType<typeof createDb>["pool"];
  org: OrgInfo;
  actor: Actor;
  run: TxRunner;
}

type OracleValue = number | string | string[];

const monthOf = (today: string, offset: number) => {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 + offset;
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
};

/** The local day of a column, in the organization's time zone. */
const localDay = (col: string) => `(${col} at time zone $2)::date`;
const OPEN = `j.status not in ('completed', 'canceled')`;
const AT_RISK = `(j.sla_resolution_state in ('at_risk', 'breached')
  or (j.first_scheduled_at is null and j.sla_response_state in ('at_risk', 'breached')))`;
const ASSIGNED = `exists (select 1 from job_assignment a where a.job_id = j.id and a.member_id = $3)`;

/**
 * Runs an oracle query with $1 = organization, $2 = its time zone, $3 = the asking member, then `params`. The outer
 * select references all three, so PostgreSQL knows their types even when a query doesn't use one.
 */
async function query(o: OracleCtx, text: string, params: unknown[]) {
  const sqlText = `select * from (${text}) q where ($1::uuid, $2::text, $3::uuid) is not null`;
  return (await o.pool.query(sqlText, [o.org.id, o.org.timezone, o.actor.memberId, ...params]))
    .rows as Record<string, unknown>[];
}
async function scalar(o: OracleCtx, text: string, params: unknown[] = []): Promise<number> {
  const rows = await query(o, text, params);
  return Number(Object.values(rows[0] ?? { n: 0 })[0] ?? 0);
}
async function column(o: OracleCtx, text: string, params: unknown[] = []): Promise<string[]> {
  return (await query(o, text, params)).map((row) => String(Object.values(row)[0]));
}
const jobNumbers = async (o: OracleCtx, where: string, params: unknown[] = []) =>
  (
    await column(
      o,
      `select j.number from job j where j.organization_id = $1 and j.deleted_at is null and ${where}
       order by j.number limit 10`,
      params,
    )
  ).map((n) => formatJobNumber(Number(n)));
const fmt = (o: OracleCtx, minor: number) => formatMoney(money(minor, o.org.currency));

/** Expected values, computed from the seeded database when the eval runs. */
const ORACLES: Record<string, (o: OracleCtx, ...args: (string | number)[]) => Promise<OracleValue>> = {
  slaRisks: (o) => jobNumbers(o, `${OPEN} and ${AT_RISK}`),
  slaRiskCount: (o) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null and ${OPEN} and ${AT_RISK}`,
    ),
  breachedCount: (o) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null and ${OPEN}
       and (j.sla_resolution_state = 'breached' or (j.first_scheduled_at is null and j.sla_response_state = 'breached'))`,
    ),
  ownSlaRisks: (o) => jobNumbers(o, `${OPEN} and ${AT_RISK} and ${ASSIGNED}`),
  othersSlaRisks: (o) => jobNumbers(o, `${OPEN} and ${AT_RISK} and not ${ASSIGNED}`),
  completedInMonth: (o, offset, pattern) => {
    const { from, to } = monthOf(o.org.today, Number(offset));
    return scalar(
      o,
      `select count(*) from job j left join service_type st on st.id = j.service_type_id
       where j.organization_id = $1 and j.deleted_at is null and j.status = 'completed'
         and ${localDay("j.completed_at")} between $4::date and $5::date and coalesce(st.name, '') ilike $6`,
      [from, to, `%${pattern ?? ""}%`],
    );
  },
  openByPriority: (o, priority) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null and ${OPEN} and j.priority = $4`,
      [priority],
    ),
  unassignedNew: (o) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null and j.status = 'new'
       and not exists (select 1 from job_assignment a where a.job_id = j.id)`,
    ),
  scheduledOn: (o, offset) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null and j.status <> 'canceled'
       and ${localDay("j.scheduled_start")} = $4::date`,
      [availability.shiftDate(o.org.today, Number(offset))],
    ),
  createdThisMonth: (o) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null
       and ${localDay("j.created_at")} >= $4::date`,
      [`${o.org.today.slice(0, 7)}-01`],
    ),
  onHold: (o) => jobNumbers(o, `j.status = 'on_hold'`),
  jobStatus: async (o, n) =>
    (
      await column(
        o,
        `select replace(status, '_', ' ') from job where organization_id = $1 and number = $4`,
        [n],
      )
    )[0] ?? "",
  jobTechnicians: (o, n) =>
    column(
      o,
      `select u.name from job j join job_assignment a on a.job_id = j.id join member m on m.id = a.member_id
       join "user" u on u.id = m.user_id where j.organization_id = $1 and j.number = $4 order by u.name`,
      [n],
    ),
  completedLastWeekBy: (o, email) => {
    const today = o.org.today;
    const end = availability.shiftDate(today, -((availability.dayOfWeek(today) + 6) % 7) - 1);
    return scalar(
      o,
      `select count(*) from job j join job_assignment a on a.job_id = j.id join member m on m.id = a.member_id
       join "user" u on u.id = m.user_id
       where j.organization_id = $1 and j.status = 'completed' and u.email = $4
         and ${localDay("j.completed_at")} between $5::date and $6::date`,
      [email, availability.shiftDate(end, -6), end],
    );
  },
  busiestCustomer: async (o) =>
    (
      await column(
        o,
        `select c.name from customer c join job j on j.customer_id = c.id where c.organization_id = $1
         and j.deleted_at is null group by c.id, c.name order by count(*) desc, c.id limit 1`,
      )
    )[0] ?? "",
  busiestCustomerJobs: (o) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null and j.customer_id =
       (select c.id from customer c join job j2 on j2.customer_id = c.id where c.organization_id = $1
        and j2.deleted_at is null group by c.id order by count(*) desc, c.id limit 1)`,
    ),
  busiestCustomerLastVisit: async (o) =>
    (
      await column(
        o,
        `select to_char(max(j.completed_at at time zone $2), 'YYYY-MM-DD') from job j where j.organization_id = $1
         and j.status = 'completed' and j.customer_id =
         (select c.id from customer c join job j2 on j2.customer_id = c.id where c.organization_id = $1
          and j2.deleted_at is null group by c.id order by count(*) desc, c.id limit 1)`,
      )
    )[0] ?? "",
  invoicedInMonth: async (o, offset) => {
    const { from, to } = monthOf(o.org.today, Number(offset));
    return fmt(
      o,
      await scalar(
        o,
        `select coalesce(sum(total_minor), 0) from invoice where organization_id = $1 and deleted_at is null
         and number is not null and status not in ('draft', 'void') and issue_date between $4::date and $5::date`,
        [from, to],
      ),
    );
  },
  collectedThisMonth: async (o) =>
    fmt(
      o,
      await scalar(
        o,
        `select coalesce(sum(p.amount_minor), 0) from payment p join invoice i on i.id = p.invoice_id
         where p.organization_id = $1 and i.deleted_at is null and ${localDay("p.paid_at")} >= $4::date`,
        [`${o.org.today.slice(0, 7)}-01`],
      ),
    ),
  outstanding: async (o) =>
    fmt(
      o,
      await scalar(
        o,
        `select coalesce(sum(total_minor - amount_paid_minor), 0) from invoice where organization_id = $1
         and deleted_at is null and number is not null and status in ('sent', 'overdue')`,
      ),
    ),
  pendingApprovals: (o) =>
    scalar(
      o,
      `select count(*) from expense_request e join job j on j.id = e.job_id where e.organization_id = $1
       and e.status = 'pending' and j.deleted_at is null
       and ($4 in ('owner', 'admin') or e.total_minor < $5)`,
      [o.actor.role, o.org.dispatcherLimitMinor],
    ),
  /** The technician with the most free time, from the workload tool itself run as the owner. */
  mostFreeTomorrowAfternoon: async (o) => {
    const [first] = assistantTools
      .bindAssistantTools(o.run, { role: "owner" }, { started: () => {}, finished: () => {} }, 1)
      .filter((t) => t.name === "technician_workload");
    const data = assistantTools.unwrapToolResult(
      await first!.execute({
        from: availability.shiftDate(o.org.today, 1),
        to: null,
        part_of_day: "afternoon",
        technician: null,
      }),
    );
    return ((data?.technicians as { name: string }[] | undefined) ?? [])[0]?.name ?? "";
  },
  visitsOn: (o, offset) =>
    scalar(
      o,
      `select count(*) from job j where j.organization_id = $1 and j.deleted_at is null and j.status <> 'canceled'
       and ${ASSIGNED} and ${localDay("j.scheduled_start")} = $4::date`,
      [availability.shiftDate(o.org.today, Number(offset))],
    ),
};

/** Whether the answer contains a number, with or without thousands separators. */
function hasNumber(text: string, n: number): boolean {
  const plain = String(n);
  const grouped = n.toLocaleString("en-US");
  const dotted = n.toLocaleString("id-ID");
  return [plain, grouped, dotted].some((s) =>
    new RegExp(`(?<![\\d.,])${s.replace(/[.,]/g, "\\$&")}(?![\\d])`).test(text),
  );
}

function grade(check: Check, value: OracleValue | null, text: string): { ok: boolean; detail: string } {
  const lower = text.toLowerCase();
  switch (check.match) {
    case "number":
      return { ok: hasNumber(text, Number(value)), detail: `number ${String(value)}` };
    case "text":
      return { ok: lower.includes(String(value).toLowerCase()), detail: `text "${String(value)}"` };
    case "all": {
      const missing = (value as string[]).filter((v) => !text.includes(v));
      return {
        ok: missing.length === 0,
        detail: missing.length ? `missing ${missing.join(", ")}` : "all records",
      };
    }
    case "none": {
      const leaked = (value as string[]).filter((v) => text.includes(v));
      return {
        ok: leaked.length === 0,
        detail: leaked.length ? `leaked ${leaked.join(", ")}` : "nothing leaked",
      };
    }
    case "phrase":
      return {
        ok: (check.values ?? []).some((p) => lower.includes(p.toLowerCase())),
        detail: `one of ${(check.values ?? []).join(" / ")}`,
      };
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  const model = createAssistantModel({
    apiKey: process.env.ANTHROPIC_API_KEY,
    provider: process.env.AI_PROVIDER,
    assistantModel: process.env.AI_MODEL_ASSISTANT,
  });
  if (!url || model.provider === "unavailable") {
    console.log(
      "Set DATABASE_URL to a seeded demo database and ANTHROPIC_API_KEY (25 questions, about $1–2), or AI_PROVIDER=fixture.",
    );
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const cases: Case[] = readFileSync(join(here, "../evals/assistant.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case);
  const { db, pool } = createDb(url, { max: 3, application: "fieldops-eval" });
  const now = new Date();
  let toolsOk = 0;
  let checksOk = 0;
  let checksTotal = 0;
  const latencies: number[] = [];
  let cost = 0;
  try {
    for (const c of cases) {
      const o = await pool.query(
        `select o.id, o.name, o.timezone, o.currency, o.settings, m.id as member_id, m.role, u.id as user_id, u.name as user_name
         from organization o join member m on m.organization_id = o.id join "user" u on u.id = m.user_id
         where o.slug = $1 and u.email = $2`,
        [c.org, USERS[c.org][c.as]],
      );
      const row = o.rows[0] as
        | {
            id: string;
            name: string;
            timezone: string;
            currency: Currency;
            settings: { approval?: { dispatcher_limit_minor?: number } };
            member_id: string;
            role: Role;
            user_id: string;
            user_name: string;
          }
        | undefined;
      if (!row)
        throw new Error(`${c.id}: ${USERS[c.org][c.as]} isn't a member of ${c.org}; seed the database first`);
      const actor: Actor = {
        userId: row.user_id,
        memberId: row.member_id,
        organizationId: row.id,
        role: row.role,
        name: row.user_name,
      };
      const run: TxRunner = (fn) =>
        withStore(db, row.id, (store) => fn({ actor, store, now, demo: false } satisfies ServiceContext));
      const org: OrgInfo = {
        id: row.id,
        name: row.name,
        timezone: row.timezone,
        currency: row.currency,
        today: availability.localDateOf(now, row.timezone),
        dispatcherLimitMinor:
          row.settings?.approval?.dispatcher_limit_minor ??
          DEFAULT_APPROVAL_THRESHOLDS[row.currency].dispatcherLimitMinor,
      };
      const called: AssistantToolName[] = [];
      const tools = assistantTools.bindAssistantTools(
        run,
        actor,
        { started: (_, name) => called.push(name), finished: () => {} },
        ASSISTANT_MAX_TOOL_CALLS,
      );
      const ctx: OracleCtx = { pool, org, actor, run };
      // "{oracle}" in a question is filled in from the database, like the expected values.
      let question = c.question;
      for (const [, name] of c.question.matchAll(/\{(\w+)\}/g)) {
        question = question.replace(`{${name}}`, String(await ORACLES[name!]!(ctx)));
      }
      const result: AssistantModelResult = await model.answer({
        context: assistant.assistantContext(
          { name: org.name, timezone: org.timezone, currency: org.currency },
          actor,
          now,
        ),
        history: [],
        question,
        tools,
        onText: () => {},
      });
      latencies.push(result.latencyMs);
      cost +=
        (result.usage.inputTokens * PRICE.input +
          result.usage.outputTokens * PRICE.output +
          result.usage.cacheReadTokens * PRICE.cacheRead +
          result.usage.cacheWriteTokens * PRICE.cacheWrite) /
        1_000_000;
      const toolPass = c.tools.length ? c.tools.every((t) => called.includes(t)) : called.length === 0;
      if (toolPass) toolsOk++;
      const results = [];
      for (const check of c.checks) {
        const value = check.oracle ? await ORACLES[check.oracle]!(ctx, ...(check.args ?? [])) : null;
        const g = grade(check, value, result.text);
        results.push(g);
        checksTotal++;
        if (g.ok) checksOk++;
      }
      const ok = toolPass && results.every((r) => r.ok) && result.kind === "answer";
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id.padEnd(16)} tools ${toolPass ? "ok" : `expected ${c.tools.join("+") || "none"}, got ${called.join("+") || "none"}`}; ${results
          .map((r) => `${r.ok ? "✓" : "✗"} ${r.detail}`)
          .join("; ")}${result.kind === "answer" ? "" : ` (${result.kind})`}`,
      );
    }
  } finally {
    await pool.end();
  }
  latencies.sort((x, y) => x - y);
  const p95 = latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] ?? 0;
  const toolRate = toolsOk / cases.length;
  const checkRate = checksTotal ? checksOk / checksTotal : 1;
  console.log(`\n${model.provider} ${model.model}: ${cases.length} questions`);
  console.log(`tools chosen   ${(toolRate * 100).toFixed(0)}% (target ${THRESHOLDS.tools * 100}%)`);
  console.log(
    `answer checks  ${(checkRate * 100).toFixed(0)}% of ${checksTotal} (target ${THRESHOLDS.checks * 100}%)`,
  );
  console.log(`p95 latency    ${(p95 / 1000).toFixed(1)} s, cost about $${cost.toFixed(2)}`);
  if (toolRate < THRESHOLDS.tools || checkRate < THRESHOLDS.checks) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
