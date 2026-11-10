import {
  can,
  dashboard,
  formatJobNumber,
  PRIORITY_LABELS,
  revenue,
  STATUS_LABELS,
  toMajor,
} from "@fieldops/core";
import { JOB_STATUSES, type Currency } from "@fieldops/shared";
import { format } from "date-fns";
import { csvRow } from "@/lib/csv";
import { inZone } from "@/lib/format";
import { getSession, resolveActor, runService, type ResolvedActor } from "@/server/context";
import { hours } from "../_components/format";

// CSV export of every dashboard report (DSH-05): the KPIs and each chart's data with the same period and filters
// as the page, and the lists on the Today tab in full. Office roles only.

export const dynamic = "force-dynamic";

const BOM = String.fromCharCode(0xfeff);
const REPORTS = [
  "kpis",
  "status",
  "sla",
  "service_types",
  "workload",
  "technicians_today",
  "unassigned",
  "at_risk",
  "approvals",
  // 0.4: revenue (DSH-01, DSH-02), owners and admins.
  "revenue_kpis",
  "revenue",
] as const;
type Report = (typeof REPORTS)[number];
type Cell = string | number | null | undefined;

function problem(status: number, title: string) {
  return Response.json(
    { type: "about:blank", title, status },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

/** A ratio as a percentage with one decimal, or empty. */
const pct = (r: number | null) => (r === null ? "" : Math.round(r * 1000) / 10);
const mins = (m: number | null) => (m === null ? "" : Math.round(m));

async function overviewTable(actor: ResolvedActor, report: Report, url: URL): Promise<Cell[][]> {
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const raw = {
    range: q("range"),
    from: q("from"),
    to: q("to"),
    technician: q("technician"),
    service_type: q("service_type"),
  };
  const data = await runService((ctx) => dashboard.getOverview(ctx, raw), actor);
  const k = data.kpis;
  switch (report) {
    case "kpis":
      return [
        ["KPI", "Value", "Previous period", "Unit", "Period", "Previous"],
        ...(
          [
            ["Jobs created", k.created, "jobs"],
            ["Jobs completed", k.completed, "jobs"],
            ["SLA compliance (resolution)", k.slaCompliance, "%"],
            ["SLA compliance (response)", k.responseCompliance, "%"],
            ["Average response time", k.avgResponseMin, "minutes"],
            ["Average resolution time", k.avgResolutionMin, "minutes"],
            ["First-visit completion", k.firstVisitRate, "%"],
          ] as const
        ).map(([label, c, unit]) => [
          label,
          unit === "%" ? pct(c.value) : unit === "minutes" ? mins(c.value) : c.value,
          unit === "%" ? pct(c.previous) : unit === "minutes" ? mins(c.previous) : c.previous,
          unit,
          `${data.range.from} – ${data.range.to}`,
          `${data.range.prevFrom} – ${data.range.prevTo}`,
        ]),
      ];
    case "status":
      return [
        ["Period start", ...JOB_STATUSES.map((s) => STATUS_LABELS[s]), "Total"],
        ...data.statusSeries.map((s) => [s.bucket, ...JOB_STATUSES.map((st) => s.counts[st]), s.total]),
      ];
    case "sla":
      return [
        ["Period start", "Completed", "Met the resolution target", "With an SLA", "Compliance %"],
        ...data.slaTrend.map((s) => [s.bucket, s.completed, s.withinTarget, s.measured, pct(s.rate)]),
      ];
    case "service_types":
      return [
        ["Service type", "Created", "Completed"],
        ...data.byServiceType.map((s) => [
          s.serviceTypeId ? s.name : "No service type",
          s.created,
          s.completed,
        ]),
      ];
    default:
      return [
        ["Technician", "Visits", "Completed", "Scheduled hours", "Working hours", "Utilization %"],
        ...data.workload.map((w) => [
          w.name,
          w.jobs,
          w.completed,
          hours(w.scheduledMin),
          hours(w.availableMin),
          pct(w.utilization),
        ]),
      ];
  }
}

async function revenueTable(actor: ResolvedActor, report: Report, url: URL): Promise<Cell[][]> {
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const data = await runService(
    (ctx) => revenue.getRevenue(ctx, { range: q("range"), from: q("from"), to: q("to") }),
    actor,
  );
  const major = (minor: number | null) => (minor === null ? "" : toMajor(minor, data.currency));
  const period = `${data.range.from} – ${data.range.to}`;
  const previous = `${data.range.prevFrom} – ${data.range.prevTo}`;
  if (report === "revenue_kpis") {
    const k = data.kpis;
    return [
      ["KPI", "Value", "Previous period", "Currency", "Period", "Previous"],
      ...(
        [
          ["Revenue invoiced", k.invoiced],
          ["Revenue collected", k.collected],
          ["Receivables at the end of the period", k.receivables],
          ["Overdue at the end of the period", k.overdue],
        ] as const
      ).map(([label, c]) => [label, major(c.value), major(c.previous), data.currency, period, previous]),
    ];
  }
  return [
    ["Period start", "Invoiced", "Collected", "Currency"],
    ...data.series.map((r) => [r.bucket, major(r.invoicedMinor), major(r.collectedMinor), data.currency]),
  ];
}

async function todayTable(actor: ResolvedActor, report: Report): Promise<Cell[][]> {
  const tz = actor.organization.timezone;
  const at = (d: Date | null) => (d ? format(inZone(d, tz), "yyyy-MM-dd HH:mm") : "");
  if (report === "technicians_today") {
    const data = await runService((ctx) => dashboard.getToday(ctx), actor);
    return [
      ["Date", "Technician", "Visits", "Scheduled hours", "Working hours", "Utilization %"],
      ...data.technicians.map((m) => [
        data.date,
        m.name,
        m.jobs,
        hours(m.scheduledMin),
        hours(m.availableMin),
        pct(m.utilization),
      ]),
    ];
  }
  if (report === "at_risk") {
    const data = await runService((ctx) => dashboard.getAtRisk(ctx), actor);
    return [
      ["Number", "Title", "Status", "Priority", "Customer", "Technicians", "SLA target", "SLA state", "Due"],
      ...data.rows.map((r) => [
        formatJobNumber(r.number),
        r.title,
        STATUS_LABELS[r.status],
        PRIORITY_LABELS[r.priority],
        r.customerName,
        r.assignees.join("; "),
        r.target === "response" ? "Response" : "Resolution",
        r.state === "breached" ? "Breached" : "At risk",
        at(r.dueAt),
      ]),
    ];
  }
  if (report === "approvals") {
    const data = await runService((ctx) => dashboard.getPendingApprovals(ctx), actor);
    return [
      ["Item", "Job", "Job title", "Requested by", "Amount", "Currency", "Requested"],
      ...data.rows.map((a) => [
        a.item,
        formatJobNumber(a.jobNumber),
        a.jobTitle,
        a.requesterName ?? "",
        toMajor(a.totalMinor, a.currency as Currency),
        a.currency,
        at(a.createdAt),
      ]),
    ];
  }
  // Unassigned queue: every new job without a technician, most urgent first.
  const page = await runService((ctx) => dashboard.getUnassigned(ctx), actor);
  return [
    ["Number", "Title", "Priority", "Customer", "Created", "SLA state", "Response due"],
    ...page.map((j) => [
      formatJobNumber(j.number),
      j.title,
      PRIORITY_LABELS[j.priority],
      j.customer.name,
      at(j.createdAt),
      j.slaResponseState ?? "",
      at(j.responseDueAt),
    ]),
  ];
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return problem(401, "Sign in to export reports");
  const actor = await resolveActor(session.user.id, session.session.activeOrganizationId);
  if (!actor) return problem(403, "You don't belong to an organization yet");
  if (!can(actor, "dashboard.operational")) return problem(403, "Only the office team can export reports");

  const url = new URL(req.url);
  const report = url.searchParams.get("report") as Report | null;
  if (!report || !REPORTS.includes(report)) {
    return problem(400, `\`report\` must be one of: ${REPORTS.join(", ")}`);
  }
  const overview = ["kpis", "status", "sla", "service_types", "workload"].includes(report);
  const money = report === "revenue_kpis" || report === "revenue";
  if (money && !can(actor, "dashboard.financial"))
    return problem(403, "Only owners and admins can export revenue");
  const table = money
    ? await revenueTable(actor, report, url)
    : overview
      ? await overviewTable(actor, report, url)
      : await todayTable(actor, report);
  const csv = BOM + table.map(csvRow).join("");
  const today = format(inZone(new Date(), actor.organization.timezone), "yyyy-MM-dd");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report.replace(/_/g, "-")}-${actor.organization.slug}-${today}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
