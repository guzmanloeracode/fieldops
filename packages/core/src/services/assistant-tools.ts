import {
  ASSISTANT_MAX_ROWS,
  ASSISTANT_TOOL_NAMES,
  assistantToolInputs,
  type AssistantRecordRef,
  type AssistantToolInput,
  type AssistantToolName,
  type Currency,
  type JobStatus,
  type PartOfDay,
  type SlaState,
} from "@fieldops/shared";
import {
  dayOfWeek,
  effectiveHours,
  localDateOf,
  localMinutesOf,
  shiftDate,
  workingWindows,
  zonedInstant,
  type TimeRange,
} from "../domain/availability";
import { DomainError, ForbiddenError } from "../domain/errors";
import { formatMoney, money } from "../domain/money";
import { formatJobNumber, parseJobNumber } from "../domain/numbering";
import { can, seesOnlyAssigned, type Actor } from "../domain/permissions";
import { currentSla } from "../domain/sla";
import type { TimeOffRecord } from "./dispatch-types";
import type { AssistantTool } from "./assistant-types";
import type { TxRunner } from "./ai-types";
import { canDecideExpense } from "./expenses";
import { getJob } from "./job-access";
import type { JobListFilters, JobView, MemberRecord, Page, ServiceContext } from "./types";

// The read-only tools of Ask FieldOps (AI-02, PRD §9.3). Each tool runs on the server in its own short tenant
// transaction, as the signed-in member: the organization and role come from the session, never from the model.
// Results are capped at 50 rows and filtered by role (technicians only reach their own jobs), and every record the
// model sees is wrapped as data, so text inside a job description can't steer the assistant.

const OPEN_STATUSES: JobStatus[] = ["new", "scheduled", "en_route", "in_progress", "on_hold"];
const MAX_WORKLOAD_DAYS = 14;
const MAX_TEXT = 400;

/** What a tool returns: a short summary for the panel, the records it touched, and the data for the model. */
export interface ToolResult {
  summary: string;
  count: number;
  refs: AssistantRecordRef[];
  data: Record<string, unknown>;
}

interface ToolDef<N extends AssistantToolName> {
  description: string;
  /** Whether the role may use the tool at all; tools a role can't use aren't offered to the model. */
  allowed(actor: Pick<Actor, "role">): boolean;
  run(ctx: ServiceContext, input: AssistantToolInput<N>): Promise<ToolResult>;
}

// ------------------------------------------------------------------ helpers

const clip = (s: string | null | undefined, max = MAX_TEXT): string | null => {
  if (!s) return null;
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2026-11-10 14:30" in the organization's time zone. */
export function localStamp(instant: Date | null, timeZone: string): string | null {
  if (!instant) return null;
  const m = localMinutesOf(instant, timeZone);
  return `${localDateOf(instant, timeZone)} ${hhmm(m)}`;
}

function hhmm(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const jobRef = (j: { id: string; number: number }): AssistantRecordRef => {
  const label = formatJobNumber(j.number);
  return { type: "job", id: j.id, label, href: `/jobs/${label}` };
};
const customerRef = (c: { id: string; name: string }): AssistantRecordRef => ({
  type: "customer",
  id: c.id,
  label: c.name,
  href: `/customers/${c.id}`,
});
const invoiceRef = (i: { id: string; number: string }): AssistantRecordRef => ({
  type: "invoice",
  id: i.id,
  label: i.number,
  href: `/invoices/${i.id}`,
});

/** Records in first-seen order without duplicates. */
export function uniqueRefs(refs: AssistantRecordRef[]): AssistantRecordRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Records whose name contains the text, exact matches first (case-insensitive). */
export function matchByName<T extends { name: string }>(items: T[], text: string): T[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const hits = items.filter((i) => i.name.toLowerCase().includes(q));
  return [
    ...hits.filter((i) => i.name.toLowerCase() === q),
    ...hits.filter((i) => i.name.toLowerCase() !== q),
  ];
}

function slaOf(job: JobView, timeZone: string) {
  const s = currentSla(job);
  return s ? { state: s.state, target: s.target, due: localStamp(s.dueAt, timeZone) } : null;
}

function jobRow(j: JobView, timeZone: string) {
  return {
    number: formatJobNumber(j.number),
    title: clip(j.title, 200),
    status: j.status,
    priority: j.priority,
    customer: j.customer.name,
    service_type: j.serviceType?.name ?? null,
    technicians: j.assignees.map((a) => a.name),
    scheduled_start: localStamp(j.scheduledStart, timeZone),
    completed_at: localStamp(j.completedAt, timeZone),
    sla: slaOf(j, timeZone),
  };
}

const assignedOnly = (ctx: ServiceContext) =>
  seesOnlyAssigned(ctx.actor) ? { assignedMemberId: ctx.actor.memberId } : {};

// ------------------------------------------------------------------ search_jobs, get_job, list_sla_risks

async function searchJobs(
  ctx: ServiceContext,
  input: AssistantToolInput<"search_jobs">,
): Promise<ToolResult> {
  const org = await ctx.store.organization.get();
  const tech = seesOnlyAssigned(ctx.actor);
  const notes: string[] = [];
  const none = (note: string): ToolResult => ({
    summary: note,
    count: 0,
    refs: [],
    data: { total: 0, shown: 0, jobs: [], notes: [note] },
  });
  const dated = Boolean(input.from || input.to);
  const dateField = input.date_field ?? "scheduled";
  const base: JobListFilters = {
    sort: dated && dateField === "scheduled" ? "scheduled_start" : "-created_at",
    limit: ASSISTANT_MAX_ROWS,
    page: 1,
    ...assignedOnly(ctx),
    ...(input.text?.trim() ? { q: input.text.trim().slice(0, 200) } : {}),
    ...(input.status?.length ? { status: input.status } : {}),
    ...(input.priority?.length ? { priority: input.priority } : {}),
    ...(input.sla?.length ? { sla: input.sla } : {}),
    ...(input.unassigned ? { unassigned: true } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    ...(dated ? { date_field: dateField } : {}),
  };
  if (input.technician?.trim()) {
    if (tech) {
      notes.push("You only see jobs assigned to you, so the technician filter was ignored.");
    } else {
      const members = await ctx.store.members.list();
      const [m] = matchByName(members, input.technician);
      if (!m) return none(`No team member matches "${clip(input.technician, 60)}"`);
      base.technician = m.id;
      notes.push(`Technician: ${m.name}`);
    }
  }
  if (input.customer?.trim()) {
    const found = await ctx.store.customers.list({
      q: input.customer.trim().slice(0, 200),
      sort: "name",
      limit: 5,
      ...assignedOnly(ctx),
    });
    const [c] = matchByName(found.rows, input.customer);
    const pick = c ?? found.rows[0];
    if (!pick) return none(`No customer matches "${clip(input.customer, 60)}"`);
    base.customer = pick.id;
    notes.push(`Customer: ${pick.name}`);
  }
  let typeIds: (string | undefined)[] = [undefined];
  if (input.service_type?.trim()) {
    const types = matchByName(
      await ctx.store.serviceTypes.list({ includeInactive: true }),
      input.service_type,
    );
    if (!types.length) return none(`No service type matches "${clip(input.service_type, 60)}"`);
    // "AC jobs" can mean several service types (AC repair, AC tune-up…): count them all.
    typeIds = types.slice(0, 6).map((t) => t.id);
    notes.push(
      `Service types: ${types
        .slice(0, 6)
        .map((t) => t.name)
        .join(", ")}`,
    );
  }
  const pages: Page<JobView>[] = await Promise.all(
    typeIds.map((id) => ctx.store.jobs.list({ ...base, ...(id ? { service_type: id } : {}) })),
  );
  const total = pages.reduce((n, p) => n + (p.total ?? p.rows.length), 0);
  let rows = pages.flatMap((p) => p.rows);
  if (pages.length > 1) rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  rows = rows.slice(0, ASSISTANT_MAX_ROWS);
  if (total > rows.length) notes.push(`Showing ${rows.length} of ${total} jobs.`);
  return {
    summary: `Looked up ${plural(total, "job")}`,
    count: total,
    refs: rows.map(jobRef),
    data: { total, shown: rows.length, jobs: rows.map((j) => jobRow(j, org.timezone)), notes },
  };
}

async function getJobTool(ctx: ServiceContext, input: AssistantToolInput<"get_job">): Promise<ToolResult> {
  const n = parseJobNumber(input.number);
  if (!n) return { summary: "Not a job number", count: 0, refs: [], data: { error: "Not a job number" } };
  // getJob reports jobs a technician isn't assigned to as not found.
  const job = await getJob(ctx, formatJobNumber(n));
  const org = await ctx.store.organization.get();
  const [checklist, notes] = await Promise.all([
    ctx.store.checklist.list(job.id),
    ctx.store.notes.list(job.id),
  ]);
  return {
    summary: `Opened ${formatJobNumber(job.number)}`,
    count: 1,
    refs: [jobRef(job), customerRef(job.customer)],
    data: {
      job: {
        ...jobRow(job, org.timezone),
        description: clip(job.description),
        source: job.source,
        site: { label: job.site.label, city: job.site.address.city },
        hold_reason: job.holdReason,
        estimated_duration_min: job.estimatedDurationMin,
        scheduled_end: localStamp(job.scheduledEnd, org.timezone),
        created_at: localStamp(job.createdAt, org.timezone),
        needs_review: job.needsReview,
        checklist: { done: checklist.filter((i) => i.doneAt).length, total: checklist.length },
        latest_notes: notes
          .slice(-3)
          .reverse()
          .map((n) => ({
            by: n.author?.name ?? null,
            at: localStamp(n.createdAt, org.timezone),
            text: clip(n.body, 300),
          })),
      },
    },
  };
}

async function listSlaRisks(
  ctx: ServiceContext,
  input: AssistantToolInput<"list_sla_risks">,
): Promise<ToolResult> {
  const org = await ctx.store.organization.get();
  const states: SlaState[] = input.states?.length ? input.states : ["at_risk", "breached"];
  const page = await ctx.store.jobs.list({
    status: OPEN_STATUSES,
    sla: states,
    sort: "-priority,created_at",
    limit: 100,
    page: 1,
    ...assignedOnly(ctx),
  });
  const dueBy = input.due_by ? zonedInstant(shiftDate(input.due_by, 1), 0, org.timezone) : null;
  const rows = page.rows
    .map((j) => ({ job: j, sla: currentSla(j) }))
    .filter((r) => r.sla && states.includes(r.sla.state))
    .filter((r) => !dueBy || (r.sla!.dueAt !== null && r.sla!.dueAt < dueBy))
    .sort((a, b) => (a.sla!.dueAt?.getTime() ?? Infinity) - (b.sla!.dueAt?.getTime() ?? Infinity));
  const shown = rows.slice(0, ASSISTANT_MAX_ROWS);
  return {
    summary: `Checked SLAs: ${plural(rows.length, "job")} at risk or breached`,
    count: rows.length,
    refs: shown.map((r) => jobRef(r.job)),
    data: {
      total: rows.length,
      shown: shown.length,
      due_by: input.due_by,
      jobs: shown.map(({ job, sla }) => ({
        number: formatJobNumber(job.number),
        title: clip(job.title, 200),
        status: job.status,
        priority: job.priority,
        customer: job.customer.name,
        technicians: job.assignees.map((a) => a.name),
        target: sla!.target,
        state: sla!.state,
        due: localStamp(sla!.dueAt, org.timezone),
      })),
    },
  };
}

// ------------------------------------------------------------------ technician_workload

const PARTS: Record<PartOfDay, [number, number]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
  all_day: [0, 24 * 60],
};

/** Subtracts busy ranges from free ones. Both lists are instants; the result keeps the order of `free`. */
export function subtractRanges(free: TimeRange[], busy: TimeRange[]): TimeRange[] {
  let out = free;
  for (const b of busy) {
    out = out.flatMap((f) => {
      if (b.end <= f.start || b.start >= f.end) return [f];
      const parts: TimeRange[] = [];
      if (b.start > f.start) parts.push({ start: f.start, end: b.start });
      if (b.end < f.end) parts.push({ start: b.end, end: f.end });
      return parts;
    });
  }
  return out;
}

const minutes = (r: TimeRange) => Math.round((r.end.getTime() - r.start.getTime()) / 60_000);

export interface DayLoad {
  date: string;
  /** "08:00–17:00" or null on a day off. */
  hours: string | null;
  capacityMin: number;
  scheduledMin: number;
  freeMin: number;
  /** Free stretches of 30 minutes or more, "13:00–15:30". */
  freeWindows: string[];
  visits: number;
  timeOff: boolean;
}

/**
 * One member's working time on a local date, limited to a part of the day: capacity (working hours minus time
 * off), the minutes of scheduled visits inside it, and the free windows left.
 */
export function dayLoad(opts: {
  date: string;
  part: PartOfDay;
  hours: { day: number; open: string; close: string }[];
  timeOff: Pick<TimeOffRecord, "startsAt" | "endsAt">[];
  visits: TimeRange[];
  timeZone: string;
}): DayLoad {
  const { date, timeZone } = opts;
  const [fromMin, toMin] = PARTS[opts.part];
  const part = { start: zonedInstant(date, fromMin, timeZone), end: zonedInstant(date, toMin, timeZone) };
  const clipTo = (r: TimeRange): TimeRange | null => {
    const start = r.start > part.start ? r.start : part.start;
    const end = r.end < part.end ? r.end : part.end;
    return start < end ? { start, end } : null;
  };
  const windows = workingWindows(opts.hours, date, timeZone)
    .map(clipTo)
    .filter((r): r is TimeRange => r !== null);
  const off = opts.timeOff.map((t) => ({ start: t.startsAt, end: t.endsAt }));
  const available = subtractRanges(windows, off);
  const visits = opts.visits.map(clipTo).filter((r): r is TimeRange => r !== null);
  const free = subtractRanges(available, visits).filter((r) => minutes(r) >= 30);
  const capacityMin = available.reduce((n, r) => n + minutes(r), 0);
  const scheduledMin = visits.reduce((n, v) => n + minutes(v), 0);
  const dow = dayOfWeek(date);
  const own = opts.hours.filter((h) => h.day === dow && h.close > h.open);
  return {
    date,
    hours: own.length ? own.map((h) => `${h.open}–${h.close}`).join(", ") : null,
    capacityMin,
    scheduledMin,
    freeMin: free.reduce((n, r) => n + minutes(r), 0),
    freeWindows: free.map(
      (r) => `${hhmm(localMinutesOf(r.start, timeZone))}–${hhmm(minutesUntil(r.end, date, timeZone))}`,
    ),
    visits: visits.length,
    timeOff: off.some((t) => windows.some((w) => t.start < w.end && w.start < t.end)),
  };
}

/** Minutes after local midnight of `date`, so a window ending at midnight reads 24:00, not 00:00. */
function minutesUntil(instant: Date, date: string, timeZone: string): number {
  return Math.round((instant.getTime() - zonedInstant(date, 0, timeZone).getTime()) / 60_000);
}

async function technicianWorkload(
  ctx: ServiceContext,
  input: AssistantToolInput<"technician_workload">,
): Promise<ToolResult> {
  const org = await ctx.store.organization.get();
  const today = localDateOf(ctx.now, org.timezone);
  const from = input.from ?? today;
  let to = input.to && input.to >= from ? input.to : from;
  if (to > shiftDate(from, MAX_WORKLOAD_DAYS - 1)) to = shiftDate(from, MAX_WORKLOAD_DAYS - 1);
  const part = input.part_of_day ?? "all_day";
  const all = await ctx.store.members.list();
  let members: MemberRecord[];
  const notes: string[] = [];
  if (seesOnlyAssigned(ctx.actor)) {
    members = all.filter((m) => m.id === ctx.actor.memberId);
    if (input.technician) notes.push("You only see your own schedule.");
  } else if (input.technician?.trim()) {
    members = matchByName(all, input.technician).slice(0, 1);
    if (!members.length) notes.push(`No team member matches "${clip(input.technician, 60)}"`);
  } else {
    members = all.filter((m) => m.role === "technician");
  }
  const rangeStart = zonedInstant(from, 0, org.timezone);
  const rangeEnd = zonedInstant(shiftDate(to, 1), 0, org.timezone);
  const memberIds = members.map((m) => m.id);
  const [jobs, timeOff] = memberIds.length
    ? await Promise.all([
        ctx.store.schedule.scheduled({
          from: rangeStart,
          to: rangeEnd,
          ...(memberIds.length === 1 ? { memberId: memberIds[0] } : {}),
        }),
        ctx.store.availability.listTimeOff({ from: rangeStart, to: rangeEnd, memberIds }),
      ])
    : [[], []];
  const dates: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) dates.push(d);
  const rows = members.map((m) => {
    const hours = effectiveHours(m.workingHours, org.businessHours);
    const visits = jobs
      .filter((j) => j.scheduledStart && j.scheduledEnd && j.assignees.some((a) => a.memberId === m.id))
      .map((j) => ({ start: j.scheduledStart!, end: j.scheduledEnd! }));
    const days = dates.map((date) =>
      dayLoad({
        date,
        part,
        hours,
        timeOff: timeOff.filter((t) => t.memberId === m.id),
        visits,
        timeZone: org.timezone,
      }),
    );
    return {
      name: m.name,
      skills: m.skills,
      free_min: days.reduce((n, d) => n + d.freeMin, 0),
      scheduled_min: days.reduce((n, d) => n + d.scheduledMin, 0),
      capacity_min: days.reduce((n, d) => n + d.capacityMin, 0),
      days: days.map((d) => ({
        date: d.date,
        working_hours: d.hours,
        capacity_min: d.capacityMin,
        scheduled_min: d.scheduledMin,
        free_min: d.freeMin,
        free_windows: d.freeWindows,
        visits: d.visits,
        time_off: d.timeOff,
      })),
    };
  });
  rows.sort((a, b) => b.free_min - a.free_min || a.name.localeCompare(b.name));
  return {
    summary: `Checked ${plural(rows.length, "schedule")}`,
    count: rows.length,
    refs: [],
    data: { from, to, part_of_day: part, time_zone: org.timezone, technicians: rows, notes },
  };
}

// ------------------------------------------------------------------ revenue_summary

async function revenueSummary(
  ctx: ServiceContext,
  input: AssistantToolInput<"revenue_summary">,
): Promise<ToolResult> {
  if (!can(ctx.actor, "dashboard.financial"))
    throw new ForbiddenError("Revenue is only for owners and admins");
  const org = await ctx.store.organization.get();
  const today = localDateOf(ctx.now, org.timezone);
  const from = input.from ?? `${today.slice(0, 7)}-01`;
  const to = input.to && input.to >= from ? input.to : today;
  const r = await ctx.store.assistant.revenue({
    from,
    to,
    timeZone: org.timezone,
    today,
    groupBy: input.group_by,
  });
  const currency = (r.currency ?? org.currency) as Currency;
  const fmt = (minor: number) => formatMoney(money(minor, currency));
  return {
    summary: `Summed ${plural(r.totals.invoiceCount, "invoice")} and ${plural(r.totals.paymentCount, "payment")}`,
    count: r.totals.invoiceCount + r.totals.paymentCount,
    refs: [],
    data: {
      from,
      to,
      currency,
      invoiced: fmt(r.totals.invoicedMinor),
      invoices_issued: r.totals.invoiceCount,
      collected: fmt(r.totals.collectedMinor),
      payments: r.totals.paymentCount,
      outstanding_now: fmt(r.totals.outstandingMinor),
      overdue_now: fmt(r.totals.overdueMinor),
      open_invoices: r.totals.openInvoiceCount,
      breakdown: input.group_by
        ? r.rows.map((row) => ({
            [input.group_by === "month" ? "month" : "service_type"]: row.label,
            invoiced: fmt(row.invoicedMinor),
            collected: fmt(row.collectedMinor),
          }))
        : null,
    },
  };
}

// ------------------------------------------------------------------ customer_history

async function customerHistory(
  ctx: ServiceContext,
  input: AssistantToolInput<"customer_history">,
): Promise<ToolResult> {
  const org = await ctx.store.organization.get();
  const found = await ctx.store.customers.list({
    q: input.customer.trim().slice(0, 200),
    sort: "name",
    limit: 6,
    ...assignedOnly(ctx),
  });
  const exact = matchByName(found.rows, input.customer).filter(
    (c) => c.name.toLowerCase() === input.customer.trim().toLowerCase(),
  );
  const candidates = exact.length ? exact.slice(0, 1) : found.rows;
  if (candidates.length !== 1) {
    const note = candidates.length
      ? "Several customers match; ask which one."
      : `No customer matches "${clip(input.customer, 60)}"`;
    return {
      summary: candidates.length ? `Found ${plural(candidates.length, "customer")}` : "No customer found",
      count: candidates.length,
      refs: candidates.map(customerRef),
      data: { matches: candidates.map((c) => c.name), notes: [note] },
    };
  }
  const c = candidates[0]!;
  const tech = seesOnlyAssigned(ctx.actor);
  const [sites, jobs, completed, stats, invoices] = await Promise.all([
    ctx.store.sites.listByCustomer(c.id),
    ctx.store.jobs.list({ customer: c.id, sort: "-created_at", limit: 10, page: 1, ...assignedOnly(ctx) }),
    ctx.store.jobs.list({
      customer: c.id,
      status: ["completed"],
      sort: "-scheduled_start",
      limit: 1,
      ...assignedOnly(ctx),
    }),
    tech ? null : ctx.store.customers.stats(c.id),
    can(ctx.actor, "billing.manage") ? ctx.store.assistant.openInvoices(c.id, 10) : null,
  ]);
  const equipment = (
    await Promise.all(
      sites.slice(0, 10).map(async (s) => ({ s, items: await ctx.store.equipment.listBySite(s.id) })),
    )
  ).flatMap(({ s, items }) =>
    items.map((e) => ({
      site: s.label,
      type: e.type,
      brand: e.brand,
      model: e.model,
      installed: e.installDate,
    })),
  );
  const last = completed.rows[0];
  return {
    summary: `Opened ${c.name}'s history`,
    count: 1,
    refs: uniqueRefs([customerRef(c), ...jobs.rows.map(jobRef), ...(invoices ?? []).map(invoiceRef)]),
    data: {
      customer: { name: c.name, type: c.type, customer_since: localDateOf(c.createdAt, org.timezone) },
      sites: sites.slice(0, 10).map((s) => ({ label: s.label, city: s.address.city })),
      equipment: equipment.slice(0, 20),
      stats: stats
        ? {
            jobs: stats.jobCount,
            open_jobs: stats.openJobCount,
            completed_jobs: stats.completedJobCount,
            last_job_at: localStamp(stats.lastJobAt, org.timezone),
          }
        : null,
      last_visit: last
        ? { job: formatJobNumber(last.number), at: localStamp(last.completedAt, org.timezone) }
        : null,
      recent_jobs: jobs.rows.map((j) => jobRow(j, org.timezone)),
      open_invoices: invoices
        ? invoices.map((i) => ({
            number: i.number,
            status: i.status,
            total: formatMoney(money(i.totalMinor, i.currency as Currency)),
            balance: formatMoney(money(i.balanceMinor, i.currency as Currency)),
            due_date: i.dueDate,
          }))
        : null,
      notes: tech ? ["You only see jobs assigned to you."] : [],
    },
  };
}

// ------------------------------------------------------------------ pending_approvals

const mayApprove = (actor: Pick<Actor, "role">) =>
  can(actor, "expenses.approve", { belowDispatcherThreshold: true });

async function pendingApprovals(
  ctx: ServiceContext,
  input: AssistantToolInput<"pending_approvals">,
): Promise<ToolResult> {
  if (!mayApprove(ctx.actor)) throw new ForbiddenError("You don't approve parts and expenses");
  const org = await ctx.store.organization.get();
  const jobNumber = input.job ? parseJobNumber(input.job) : null;
  const { rows } = await ctx.store.dashboard.pendingApprovals(200);
  const mine = rows
    .filter((r) => canDecideExpense(ctx.actor, r, org.settings))
    .filter((r) => jobNumber === null || r.jobNumber === jobNumber);
  const shown = mine.slice(0, ASSISTANT_MAX_ROWS);
  // The approvals row carries the job's number, not its id; the number identifies it as well.
  const refs = uniqueRefs(
    shown.flatMap((r): AssistantRecordRef[] => {
      const label = formatJobNumber(r.jobNumber);
      return [
        { type: "expense", id: r.id, label: r.item, href: "/approvals" },
        { type: "job", id: label, label, href: `/jobs/${label}` },
      ];
    }),
  );
  return {
    summary: `Found ${plural(mine.length, "pending request")}`,
    count: mine.length,
    refs,
    data: {
      total: mine.length,
      shown: shown.length,
      requests: shown.map((r) => ({
        item: clip(r.item, 200),
        amount: formatMoney(money(r.totalMinor, r.currency as Currency)),
        requested_by: r.requesterName,
        job: formatJobNumber(r.jobNumber),
        job_title: clip(r.jobTitle, 200),
        requested_at: localStamp(r.createdAt, org.timezone),
      })),
    },
  };
}

// ------------------------------------------------------------------ the tool table

const anyRole = () => true;

export const ASSISTANT_TOOLS: { [N in AssistantToolName]: ToolDef<N> } = {
  search_jobs: {
    description:
      "Search the organization's jobs (work orders) by text, status, priority, technician, customer, service type, date range, SLA state or missing technician. Returns up to 50 jobs, newest first, and the total count; use the total for questions like 'how many'. Call it once per period when comparing periods.",
    allowed: anyRole,
    run: searchJobs,
  },
  get_job: {
    description:
      "Get one job by its number (JOB-000123): status, customer, site, technicians, schedule, SLA, checklist progress, description and the latest notes.",
    allowed: anyRole,
    run: getJobTool,
  },
  list_sla_risks: {
    description:
      "List open jobs whose SLA is at risk or already breached, the earliest deadline first, with the target (response or resolution) and when it is due. Use due_by to keep only deadlines up to a day, e.g. today.",
    allowed: anyRole,
    run: listSlaRisks,
  },
  technician_workload: {
    description:
      "Technicians' working hours, scheduled visit minutes and free windows for a day or a range of up to 14 days, optionally only the morning, afternoon or evening. Sorted by free time, so it answers 'who has capacity tomorrow afternoon?'.",
    allowed: anyRole,
    run: technicianWorkload,
  },
  revenue_summary: {
    description:
      "Money for a period: invoiced (invoices issued, not void), collected (payments received), and the open balance now with its overdue part. Optionally broken down by month or service type.",
    allowed: (actor) => can(actor, "dashboard.financial"),
    run: revenueSummary,
  },
  customer_history: {
    description:
      "One customer's history by name: sites, equipment, job counts, the last visit, recent jobs and open invoices. When several customers match it returns their names to ask which one.",
    allowed: anyRole,
    run: customerHistory,
  },
  pending_approvals: {
    description:
      "Parts and expense requests waiting for a decision that the current user may approve, with amounts, the requester and the job.",
    allowed: mayApprove,
    run: pendingApprovals,
  },
};

/** The tools a role may use, in a fixed order (a stable tool list keeps the prompt cache warm). */
export function toolsFor(actor: Pick<Actor, "role">): AssistantToolName[] {
  return ASSISTANT_TOOL_NAMES.filter((n) => ASSISTANT_TOOLS[n].allowed(actor));
}

// ------------------------------------------------------------------ binding and the data wrapper

/**
 * The result as the model sees it: JSON inside a <tool_result> element. Angle brackets in the JSON are escaped
 * (`<`, still valid JSON), so text from a record can't close the element or open a new one. The system prompt
 * says everything inside is data.
 */
export function wrapToolResult(name: AssistantToolName, payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  return `<tool_result name="${name}">\n${json}\n</tool_result>`;
}

/** Reads a wrapped result back (the fixture model and tests). */
export function unwrapToolResult(content: string): Record<string, unknown> | null {
  const m = /^<tool_result name="[a-z_]+">\n([\s\S]*)\n<\/tool_result>$/.exec(content);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface ToolCallEvents {
  started(callId: string, name: AssistantToolName): void;
  finished(callId: string, run: { name: AssistantToolName; ok: boolean } & Omit<ToolResult, "data">): void;
  /** An unexpected error in a tool (a domain error is an ordinary result). */
  error?(err: unknown, name: AssistantToolName): void;
}

/**
 * Binds the role's tools to the member: each call opens its own tenant transaction through `run`, so nothing
 * stays open while the model streams. At most `maxCalls` calls run; later calls get an error result that asks the
 * model to answer with what it has.
 */
export function bindAssistantTools(
  run: TxRunner,
  actor: Pick<Actor, "role">,
  events: ToolCallEvents,
  maxCalls: number,
): AssistantTool[] {
  let calls = 0;
  return toolsFor(actor).map((name) => {
    const def = ASSISTANT_TOOLS[name] as ToolDef<AssistantToolName>;
    const schema = assistantToolInputs[name];
    return {
      name,
      description: def.description,
      input: schema,
      async execute(raw: unknown): Promise<string> {
        if (calls >= maxCalls) {
          return wrapToolResult(name, {
            error: `The limit of ${maxCalls} lookups per question is reached. Answer with what you have.`,
          });
        }
        calls += 1;
        const callId = `call_${calls}`;
        events.started(callId, name);
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          events.finished(callId, { name, ok: false, summary: "Invalid lookup", count: 0, refs: [] });
          return wrapToolResult(name, { error: "Invalid input", issues: parsed.error.issues.slice(0, 5) });
        }
        try {
          const result = await run((ctx) =>
            (def.run as (c: ServiceContext, i: unknown) => Promise<ToolResult>)(ctx, parsed.data),
          );
          events.finished(callId, {
            name,
            ok: true,
            summary: result.summary,
            count: result.count,
            refs: uniqueRefs(result.refs),
          });
          return wrapToolResult(name, { summary: result.summary, ...result.data });
        } catch (err) {
          const known = err instanceof DomainError;
          if (!known) events.error?.(err, name);
          const message = known ? err.message : "The lookup failed";
          events.finished(callId, { name, ok: false, summary: message, count: 0, refs: [] });
          return wrapToolResult(name, { error: message });
        }
      },
    };
  });
}
