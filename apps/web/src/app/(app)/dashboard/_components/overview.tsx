import type { dashboard } from "@fieldops/core";
import { JOB_STATUSES, type DashboardRange } from "@fieldops/shared";
import { Download } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bucketEnd, jobsHref } from "@/lib/drilldown";
import { PairChart, SlaChart, StatusChart, type StatusPoint } from "./charts";
import { formatCount, formatPercent, hours, longDate, shortDate, STATUS_COLORS } from "./format";
import { KpiTiles, type KpiTile } from "./kpi-tiles";
import { RangeFilters } from "./range-filters";

type Option = { id: string; name: string };

function ChartCard({
  id,
  title,
  description,
  chart,
  table,
  showData,
  csv,
}: {
  id: string;
  title: string;
  description: string;
  chart: ReactNode;
  table: ReactNode;
  showData: string;
  /** The same data as a CSV download (DSH-05). */
  csv: { href: string; label: string; text: string };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle id={`${id}-title`} className="text-base">
          {title}
        </CardTitle>
        <CardDescription id={`${id}-desc`}>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <figure aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`} className="m-0">
          {chart}
        </figure>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <details data-testid={`${id}-data`} className="min-w-0 flex-1">
            <summary className="text-primary cursor-pointer text-sm hover:underline">{showData}</summary>
            <div className="mt-2 max-h-80 overflow-auto rounded-md border">{table}</div>
          </details>
          <CsvLink {...csv} testId={`${id}-csv`} />
        </div>
      </CardContent>
    </Card>
  );
}

const cellLink = "text-primary tabular-nums hover:underline";

/** A plain download link: the browser saves the CSV the route handler returns. */
export function CsvLink({
  href,
  label,
  text,
  testId,
}: {
  href: string;
  label: string;
  text: string;
  testId: string;
}) {
  return (
    <a
      href={href}
      download
      aria-label={label}
      data-testid={testId}
      className="text-primary inline-flex items-center gap-1 text-sm whitespace-nowrap hover:underline"
    >
      <Download className="size-3.5" aria-hidden />
      {text}
    </a>
  );
}

/** The CSV export of one dashboard report with the page's period and filters (DSH-05). */
export function exportHref(report: string, params: Record<string, string | null | undefined> = {}) {
  const p = new URLSearchParams({ report });
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  return `/dashboard/export?${p.toString()}`;
}

/** Owner and dispatcher KPIs and charts (DSH-01 – DSH-03). */
export async function Overview({
  data,
  preset,
  technicians,
  serviceTypes,
}: {
  data: dashboard.DashboardOverview;
  preset: DashboardRange;
  technicians: Option[];
  serviceTypes: Option[];
}) {
  const t = await getTranslations("dashboard");
  const tStatus = await getTranslations("common.status");
  const locale = await getLocale();
  const { range, filters } = data;
  const base = { technician: filters.technicianId, service_type: filters.serviceTypeId };
  const period = { from: range.from, to: range.to };
  const clampFrom = (b: string) => (b < range.from ? range.from : b);
  const created = (extra: Record<string, string | boolean | null> = {}) =>
    jobsHref({ ...base, date_field: "created", ...period, sort: "-created_at", ...extra });
  const completed = (extra: Record<string, string | boolean | null> = {}) =>
    jobsHref({ ...base, status: "completed", date_field: "completed", ...period, ...extra });

  const k = data.kpis;
  const tiles: KpiTile[] = [
    {
      key: "created",
      label: t("kpi.created"),
      value: k.created,
      kind: "count",
      higherIsBetter: true,
      href: created(),
    },
    {
      key: "completed",
      label: t("kpi.completed"),
      value: k.completed,
      kind: "count",
      higherIsBetter: true,
      href: completed(),
    },
    {
      key: "sla",
      label: t("kpi.sla"),
      note: t("kpi.slaNote", { response: formatPercent(k.responseCompliance.value, locale) }),
      value: k.slaCompliance,
      kind: "rate",
      higherIsBetter: true,
      href: completed(),
    },
    {
      key: "response",
      label: t("kpi.response"),
      note: t("kpi.responseNote"),
      value: k.avgResponseMin,
      kind: "minutes",
      higherIsBetter: false,
      href: created(),
    },
    {
      key: "resolution",
      label: t("kpi.resolution"),
      note: t("kpi.resolutionNote"),
      value: k.avgResolutionMin,
      kind: "minutes",
      higherIsBetter: false,
      href: completed(),
    },
    {
      key: "first-visit",
      label: t("kpi.firstVisit"),
      note: t("kpi.firstVisitNote"),
      value: k.firstVisitRate,
      kind: "rate",
      higherIsBetter: true,
      href: completed({ revisit: true }),
    },
  ];

  const statusPoints: StatusPoint[] = data.statusSeries.map((s) => {
    const from = clampFrom(s.bucket);
    const to = bucketEnd(s.bucket, range.bucket, range.to);
    return {
      label: shortDate(from, locale),
      counts: s.counts,
      hrefs: Object.fromEntries(
        JOB_STATUSES.map((st) => [st, jobsHref({ ...base, status: st, date_field: "created", from, to })]),
      ) as StatusPoint["hrefs"],
    };
  });
  const usedStatuses = JOB_STATUSES.filter((s) => data.statusSeries.some((p) => p.counts[s] > 0));
  const slaPoints = data.slaTrend.map((s) => {
    const from = clampFrom(s.bucket);
    return {
      label: shortDate(from, locale),
      rate: s.rate,
      href: jobsHref({
        ...base,
        status: "completed",
        date_field: "completed",
        from,
        to: bucketEnd(s.bucket, range.bucket, range.to),
      }),
    };
  });
  const typeHref = (id: string | null) => (id ? created({ service_type: id }) : null);
  const techHref = (id: string) =>
    jobsHref({ service_type: filters.serviceTypeId, technician: id, ...period });
  const hasJobs = data.statusSeries.some((s) => s.total > 0);
  const query = {
    range: preset,
    from: preset === "custom" ? range.from : null,
    to: preset === "custom" ? range.to : null,
    technician: filters.technicianId,
    service_type: filters.serviceTypeId,
  };
  const csv = (report: string, title: string) => ({
    href: exportHref(report, query),
    label: t("charts.downloadCsvLabel", { report: title }),
    text: t("charts.downloadCsv"),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <RangeFilters
          range={preset}
          from={range.from}
          to={range.to}
          technician={filters.technicianId}
          serviceType={filters.serviceTypeId}
          technicians={technicians}
          serviceTypes={serviceTypes}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-muted-foreground text-sm" data-testid="dashboard-period">
            {t("filters.period", {
              from: longDate(range.from, locale),
              to: longDate(range.to, locale),
              prevFrom: longDate(range.prevFrom, locale),
              prevTo: longDate(range.prevTo, locale),
            })}
          </p>
          <CsvLink
            href={exportHref("kpis", query)}
            label={t("filters.downloadKpis")}
            text={t("filters.downloadKpis")}
            testId="kpis-csv"
          />
        </div>
      </div>
      <KpiTiles tiles={tiles} />
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          id="chart-status"
          title={t("charts.statusTitle")}
          description={t("charts.statusDescription", { bucket: range.bucket })}
          showData={t("charts.showData")}
          csv={csv("status", t("charts.statusTitle"))}
          chart={
            hasJobs ? (
              <StatusChart data={statusPoints} />
            ) : (
              <p className="text-muted-foreground py-10 text-center text-sm">{t("charts.empty")}</p>
            )
          }
          table={
            <Table>
              <caption className="sr-only">{t("charts.statusTitle")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("charts.period")}</TableHead>
                  {usedStatuses.map((s) => (
                    <TableHead key={s} scope="col" className="text-right">
                      <span
                        aria-hidden
                        className="mr-1 inline-block size-2 rounded-full"
                        style={{ background: STATUS_COLORS[s] }}
                      />
                      {tStatus(s)}
                    </TableHead>
                  ))}
                  <TableHead scope="col" className="text-right">
                    {t("charts.total")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.statusSeries.map((s, i) => (
                  <TableRow key={s.bucket}>
                    <TableCell>{statusPoints[i]!.label}</TableCell>
                    {usedStatuses.map((st) => (
                      <TableCell key={st} className="text-right">
                        {s.counts[st] ? (
                          <Link href={statusPoints[i]!.hrefs[st]} className={cellLink}>
                            {s.counts[st]}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{s.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
        <ChartCard
          id="chart-sla"
          title={t("charts.slaTitle")}
          description={t("charts.slaDescription", { bucket: range.bucket })}
          showData={t("charts.showData")}
          csv={csv("sla", t("charts.slaTitle"))}
          chart={<SlaChart data={slaPoints} name={t("charts.compliance")} />}
          table={
            <Table>
              <caption className="sr-only">{t("charts.slaTitle")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("charts.period")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.completed")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.withinTarget")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.compliance")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.slaTrend.map((s, i) => (
                  <TableRow key={s.bucket}>
                    <TableCell>{slaPoints[i]!.label}</TableCell>
                    <TableCell className="text-right">
                      {s.completed ? (
                        <Link href={slaPoints[i]!.href} className={cellLink}>
                          {s.completed}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.withinTarget}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(s.rate, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
        <ChartCard
          id="chart-types"
          title={t("charts.typeTitle")}
          description={t("charts.typeDescription")}
          showData={t("charts.showData")}
          csv={csv("service_types", t("charts.typeTitle"))}
          chart={
            data.byServiceType.length ? (
              <PairChart
                data={data.byServiceType.map((s) => ({
                  label: s.serviceTypeId ? s.name : t("charts.noServiceType"),
                  a: s.created,
                  b: s.completed,
                  href: typeHref(s.serviceTypeId),
                }))}
                names={[t("charts.created"), t("charts.completed")]}
                colors={["#0ea5e9", "#10b981"]}
              />
            ) : (
              <p className="text-muted-foreground py-10 text-center text-sm">{t("charts.empty")}</p>
            )
          }
          table={
            <Table>
              <caption className="sr-only">{t("charts.typeTitle")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("charts.serviceType")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.created")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.completed")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byServiceType.map((s) => (
                  <TableRow key={s.serviceTypeId ?? "none"}>
                    <TableCell>{s.serviceTypeId ? s.name : t("charts.noServiceType")}</TableCell>
                    <TableCell className="text-right">
                      {s.serviceTypeId ? (
                        <Link href={typeHref(s.serviceTypeId)!} className={cellLink}>
                          {formatCount(s.created, locale)}
                        </Link>
                      ) : (
                        formatCount(s.created, locale)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.serviceTypeId ? (
                        <Link href={completed({ service_type: s.serviceTypeId })} className={cellLink}>
                          {formatCount(s.completed, locale)}
                        </Link>
                      ) : (
                        formatCount(s.completed, locale)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
        <ChartCard
          id="chart-workload"
          title={t("charts.workloadTitle")}
          description={t("charts.workloadDescription")}
          showData={t("charts.showData")}
          csv={csv("workload", t("charts.workloadTitle"))}
          chart={
            data.workload.length ? (
              <PairChart
                data={data.workload.map((w) => ({
                  label: w.name,
                  a: hours(w.scheduledMin),
                  b: hours(w.availableMin),
                  href: techHref(w.memberId),
                }))}
                names={[t("charts.scheduledHours"), t("charts.workingHours")]}
                colors={["#6366f1", "#cbd5e1"]}
                unit={t("charts.hourUnit")}
              />
            ) : (
              <p className="text-muted-foreground py-10 text-center text-sm">{t("charts.noTechnicians")}</p>
            )
          }
          table={
            <Table>
              <caption className="sr-only">{t("charts.workloadTitle")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("charts.technician")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.visits")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.scheduledHours")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.workingHours")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("charts.utilization")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.workload.map((w) => (
                  <TableRow key={w.memberId}>
                    <TableCell>{w.name}</TableCell>
                    <TableCell className="text-right">
                      <Link href={techHref(w.memberId)} className={cellLink}>
                        {w.jobs}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{hours(w.scheduledMin)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hours(w.availableMin)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(w.utilization, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
      </div>
    </div>
  );
}
