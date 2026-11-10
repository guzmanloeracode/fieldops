import {
  assistantTools,
  type AssistantContext,
  type AssistantModel,
  type AssistantModelInput,
  type AssistantModelResult,
  type AssistantTool,
} from "@fieldops/core";
import type { AssistantToolName } from "@fieldops/shared";

// TEST DOUBLE. A deterministic stand-in for Ask FieldOps, used by the E2E suite and local development
// (AI_PROVIDER=fixture). It never calls a model: it picks tools from keywords in the question, runs them for real
// (through the same bound tools, so role filtering and the data wrapper are exercised), and writes a templated
// answer from their results. "[[refuse]]" or "[[fail]]" in a question returns a refusal or an error.

type Data = Record<string, unknown>;
type Row = Record<string, unknown>;

export interface FixturePlan {
  name: AssistantToolName;
  input: Record<string, unknown>;
}

const DAY_MS = 86_400_000;

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The first and last day of the month `offset` months from the month of `date`. */
export function monthRange(date: string, offset: number): { from: string; to: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + offset;
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

const STATUS_WORDS: [RegExp, string][] = [
  [/\b(complete\w*|finish\w*|done|selesai)\b/, "completed"],
  [/\bin progress\b/, "in_progress"],
  [/\bon hold\b/, "on_hold"],
  [/\b(canceled|cancelled)\b/, "canceled"],
  [/\bscheduled\b/, "scheduled"],
  [/\b(new|unscheduled)\b/, "new"],
];
const NOT_A_SERVICE =
  /^(how|many|the|all|my|our|open|which|what|new|completed|urgent|high|any|these|those)$/i;

/** Which tools the fixture calls for a question, with their inputs. Exported for tests and the eval baseline. */
export function planAssistantTools(question: string, ctx: Pick<AssistantContext, "today">): FixturePlan[] {
  const q = question.toLowerCase();
  const day = /\b(tomorrow|besok)\b/.test(q)
    ? shift(ctx.today, 1)
    : /\b(today|hari ini)\b/.test(q)
      ? ctx.today
      : null;
  const jobNumber = /\bjob-?\d{1,9}\b/i.exec(question);
  if (jobNumber) return [{ name: "get_job", input: { number: jobNumber[0] } }];
  if (/\b(sla|at risk|risk|breach\w*|late)\b/.test(q)) {
    // "At risk of breaching today" means the jobs at risk now; only "due today" limits the deadline.
    return [{ name: "list_sla_risks", input: { states: null, due_by: /\bdue\b/.test(q) ? day : null } }];
  }
  if (/\b(capacity|free|available|availability|workload|busy|kapasitas)\b/.test(q)) {
    const part = /\bafternoon\b|\bsiang\b|\bsore\b/.test(q)
      ? "afternoon"
      : /\bmorning\b|\bpagi\b/.test(q)
        ? "morning"
        : /\bevening\b|\bmalam\b/.test(q)
          ? "evening"
          : null;
    return [
      {
        name: "technician_workload",
        input: { from: day ?? ctx.today, to: null, part_of_day: part, technician: null },
      },
    ];
  }
  if (/\b(revenue|invoiced|collected|outstanding|receivables?|income|pendapatan)\b/.test(q)) {
    const range = /\blast month\b/.test(q) ? monthRange(ctx.today, -1) : { from: null, to: null };
    const groupBy = /\b(by|per) month\b/.test(q)
      ? "month"
      : /\bservice type\b/.test(q)
        ? "service_type"
        : null;
    return [{ name: "revenue_summary", input: { ...range, group_by: groupBy } }];
  }
  if (/\b(approv\w*|pending|expenses?|parts? requests?)\b/.test(q)) {
    return [{ name: "pending_approvals", input: { job: null } }];
  }
  // The name after the last "customer" / "history of" / "pelanggan".
  const customer = /.*\b(?:customer|history of|history for|pelanggan)\s+["“]?([^"”?]+?)["”]?\s*\??$/i.exec(
    question.trim(),
  );
  if (customer?.[1]) return [{ name: "customer_history", input: { customer: customer[1].trim() } }];

  const status = STATUS_WORDS.find(([re]) => re.test(q))?.[1] ?? null;
  const service = /\b([A-Za-z][\w-]*)\s+jobs\b/.exec(question)?.[1];
  const priority = /\burgent\b/.test(q) ? ["urgent"] : /\bhigh[- ]priority\b/.test(q) ? ["high"] : null;
  const base = {
    text: null,
    status: status ? [status] : null,
    priority,
    technician: null,
    customer: null,
    service_type: service && !NOT_A_SERVICE.test(service) ? service : null,
    date_field: null as string | null,
    from: null as string | null,
    to: null as string | null,
    sla: null,
    unassigned: /\bunassigned\b/.test(q) ? true : null,
  };
  const dateField = status === "completed" ? "completed" : "created";
  if (/\blast month\b/.test(q)) {
    const plans: FixturePlan[] = [
      { name: "search_jobs", input: { ...base, date_field: dateField, ...monthRange(ctx.today, -1) } },
    ];
    if (/\b(month before|previous month|compared)\b/.test(q)) {
      plans.push({
        name: "search_jobs",
        input: { ...base, date_field: dateField, ...monthRange(ctx.today, -2) },
      });
    }
    return plans;
  }
  if (day) return [{ name: "search_jobs", input: { ...base, date_field: "scheduled", from: day, to: day } }];
  return [{ name: "search_jobs", input: base }];
}

// ------------------------------------------------------------------ answer templates

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const count = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const human = (status: unknown) => s(status).replaceAll("_", " ");

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

function more(total: number, shown: number) {
  return total > shown ? `\n\n…and ${total - shown} more.` : "";
}

function slaAnswer(d: Data): string {
  const total = n(d.total);
  const when = d.due_by ? ` by the end of ${s(d.due_by)}` : "";
  if (!total) return `No open jobs are at risk of missing their SLA${when}.`;
  const list = rows(d.jobs).slice(0, 10);
  const lines = list.map(
    (j) =>
      `- **${s(j.number)}** ${s(j.title)} (${s(j.customer)}): ${s(j.target)} ${j.state === "breached" ? "was due" : "due"} ${s(j.due)}, ${j.state === "breached" ? "breached" : "at risk"}`,
  );
  return `**${count(total, "job")}** ${total === 1 ? "is" : "are"} at risk of missing or already past the SLA${when}:\n\n${lines.join("\n")}${more(total, list.length)}`;
}

function jobsAnswer(results: Data[], plans: FixturePlan[]): string {
  if (results.length === 2) {
    const [a, b] = results.map((r) => n(r.total));
    const what = [
      plans[0]!.input.status ? human((plans[0]!.input.status as string[])[0]) : "",
      s(plans[0]!.input.service_type),
    ]
      .filter(Boolean)
      .join(" ");
    const diff = a! - b!;
    const change = diff === 0 ? "the same" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"}`;
    return `Last month (${s(plans[0]!.input.from)} to ${s(plans[0]!.input.to)}): **${count(a!, `${what} job`.trim())}**. The month before: **${b}**. That's ${change} than the month before.`;
  }
  const d = results[0]!;
  const total = n(d.total);
  const notes = rows(d.notes).length ? ` ${(d.notes as string[]).join(" ")}` : "";
  if (!total) return `I didn't find any matching jobs.${notes}`;
  const list = rows(d.jobs).slice(0, 8);
  const lines = list.map((j) => `- **${s(j.number)}** ${s(j.title)}: ${human(j.status)}, ${s(j.customer)}`);
  return `I found **${count(total, "job")}**.${notes}\n\n${lines.join("\n")}${more(total, list.length)}`;
}

function jobAnswer(d: Data): string {
  const j = (d.job ?? {}) as Row;
  const sla = j.sla as Row | null;
  const checklist = j.checklist as Row | undefined;
  const techs = rows(j.technicians).length ? (j.technicians as string[]).join(", ") : "nobody yet";
  return [
    `**${s(j.number)}** ${s(j.title)} is ${human(j.status)} (${s(j.priority)} priority) for ${s(j.customer)}.`,
    "",
    `- Technicians: ${techs}`,
    `- Scheduled: ${s(j.scheduled_start) || "not scheduled"}`,
    `- SLA: ${sla ? `${human(sla.state)}, ${s(sla.target)} due ${s(sla.due)}` : "none"}`,
    `- Checklist: ${n(checklist?.done)} of ${n(checklist?.total)} done`,
  ].join("\n");
}

function workloadAnswer(d: Data): string {
  const part = d.part_of_day && d.part_of_day !== "all_day" ? ` in the ${s(d.part_of_day)}` : "";
  const when = d.from === d.to ? `on ${s(d.from)}` : `from ${s(d.from)} to ${s(d.to)}`;
  const techs = rows(d.technicians);
  const free = techs.filter((t) => n(t.free_min) > 0);
  if (!free.length) return `Nobody has free time ${when}${part}.`;
  const lines = free.map((t) => {
    const windows = rows(t.days).flatMap((day) => (day.free_windows as string[]) ?? []);
    return `- **${s(t.name)}**: ${duration(n(t.free_min))} free (${windows.slice(0, 3).join(", ")})`;
  });
  return `${count(free.length, "technician")} ${free.length === 1 ? "has" : "have"} free time ${when}${part}:\n\n${lines.join("\n")}`;
}

function revenueAnswer(d: Data): string {
  const head = `From ${s(d.from)} to ${s(d.to)}: invoiced **${s(d.invoiced)}** (${count(n(d.invoices_issued), "invoice")}), collected **${s(d.collected)}** (${count(n(d.payments), "payment")}). Outstanding now: **${s(d.outstanding_now)}**, of which ${s(d.overdue_now)} is overdue.`;
  const breakdown = rows(d.breakdown);
  if (!breakdown.length) return head;
  const key = "month" in breakdown[0]! ? "month" : "service_type";
  const table = [
    `| ${key === "month" ? "Month" : "Service type"} | Invoiced | Collected |`,
    "| --- | --- | --- |",
    ...breakdown.map((r) => `| ${s(r[key])} | ${s(r.invoiced)} | ${s(r.collected)} |`),
  ];
  return `${head}\n\n${table.join("\n")}`;
}

function customerAnswer(d: Data): string {
  if (!d.customer) {
    const matches = (d.matches as string[] | undefined) ?? [];
    return matches.length
      ? `Several customers match: ${matches.join(", ")}. Which one do you mean?`
      : s(rows(d.notes)[0] ?? d.notes);
  }
  const c = d.customer as Row;
  const stats = d.stats as Row | null;
  const last = d.last_visit as Row | null;
  const out = [
    `**${s(c.name)}** (${s(c.type)}) has been a customer since ${s(c.customer_since)}.`,
    "",
    ...(stats ? [`- Jobs: ${n(stats.jobs)} in total, ${n(stats.open_jobs)} open`] : []),
    `- Last visit: ${last ? `${s(last.at)} (**${s(last.job)}**)` : "none yet"}`,
    `- Equipment: ${
      rows(d.equipment)
        .map((e) => [e.brand, e.type].filter(Boolean).join(" "))
        .join(", ") || "none recorded"
    }`,
  ];
  const recent = rows(d.recent_jobs).slice(0, 5);
  if (recent.length)
    out.push(
      "",
      "Recent jobs:",
      ...recent.map((j) => `- **${s(j.number)}** ${s(j.title)}: ${human(j.status)}`),
    );
  const invoices = rows(d.open_invoices);
  if (invoices.length)
    out.push(
      "",
      "Open invoices:",
      ...invoices.map((i) => `- **${s(i.number)}**: ${s(i.balance)} due ${s(i.due_date)}`),
    );
  return out.join("\n");
}

function approvalsAnswer(d: Data): string {
  const total = n(d.total);
  if (!total) return "There are no parts or expense requests waiting for your approval.";
  const list = rows(d.requests).slice(0, 10);
  const lines = list.map(
    (r) =>
      `- ${s(r.item)}, ${s(r.amount)}, requested by ${s(r.requested_by) || "someone"} on **${s(r.job)}**`,
  );
  return `**${count(total, "request")}** ${total === 1 ? "waits" : "wait"} for your approval:\n\n${lines.join("\n")}${more(total, list.length)}`;
}

/** The fixture's answer for the results of its plan. */
export function fixtureAnswer(plans: FixturePlan[], results: (Data | null)[]): string {
  const failed = results.find((r) => !r || typeof r.error === "string");
  if (failed !== undefined) return `I couldn't look that up: ${s(failed?.error) || "the lookup failed"}.`;
  const data = results as Data[];
  switch (plans[0]!.name) {
    case "list_sla_risks":
      return slaAnswer(data[0]!);
    case "search_jobs":
      return jobsAnswer(data, plans);
    case "get_job":
      return jobAnswer(data[0]!);
    case "technician_workload":
      return workloadAnswer(data[0]!);
    case "revenue_summary":
      return revenueAnswer(data[0]!);
    case "customer_history":
      return customerAnswer(data[0]!);
    case "pending_approvals":
      return approvalsAnswer(data[0]!);
  }
}

export class FixtureAssistantModel implements AssistantModel {
  readonly provider = "fixture" as const;
  readonly model = "fixture-assistant";

  async answer(input: AssistantModelInput): Promise<AssistantModelResult> {
    const usage = (calls: number, text: string) => ({
      inputTokens: 900 + 450 * calls + Math.ceil(input.question.length / 4),
      outputTokens: 60 + Math.ceil(text.length / 4),
      cacheReadTokens: 5200,
      cacheWriteTokens: 0,
    });
    const base = (calls: number, text: string) => ({
      model: this.model,
      usage: usage(calls, text),
      latencyMs: 40 + 25 * calls,
      text,
    });
    if (input.question.includes("[[refuse]]"))
      return { kind: "refused", ...base(0, ""), stopReason: "refusal", error: null };
    if (input.question.includes("[[fail]]"))
      return { kind: "failed", ...base(0, ""), stopReason: null, error: "Fixture failure" };
    const tools = new Map<string, AssistantTool>(input.tools.map((t) => [t.name, t]));
    const plans = planAssistantTools(input.question, input.context);
    if (plans.some((p) => !tools.has(p.name))) {
      const text = "I can't look that up for your role.";
      this.stream(text, input.onText);
      return { kind: "answer", ...base(0, text), stopReason: "end_turn" };
    }
    const results: (Data | null)[] = [];
    for (const p of plans)
      results.push(assistantTools.unwrapToolResult(await tools.get(p.name)!.execute(p.input)));
    const text = fixtureAnswer(plans, results);
    this.stream(text, input.onText);
    return { kind: "answer", ...base(plans.length, text), stopReason: "end_turn" };
  }

  /** Sends the answer in small pieces, like a streamed response. */
  private stream(text: string, onText: (delta: string) => void) {
    for (const piece of text.match(/\S+\s*|\s+/g) ?? []) onText(piece);
  }
}
