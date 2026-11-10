import type { revenue } from "@fieldops/core";
import type { DashboardRange } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { money } from "@/components/billing/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { shortDate } from "./format";
import { KpiTiles, type KpiTile } from "./kpi-tiles";
import { CsvLink, exportHref } from "./overview";
import { RevenueChart } from "./revenue-chart";

/**
 * Revenue on the overview for owners and admins (DSH-01, DSH-02): invoiced, collected, receivables and the overdue
 * part, against the previous period, and the trend. Technician and service type filters don't apply to money.
 */
export async function Revenue({ data, preset }: { data: revenue.RevenueOverview; preset: DashboardRange }) {
  const t = await getTranslations("billing.dashboard");
  const { range, currency } = data;
  const show = (v: number | null) => (v === null ? "—" : money(v, currency));
  const period = `from=${range.from}&to=${range.to}`;
  const tiles: KpiTile[] = [
    {
      key: "invoiced",
      label: t("invoiced"),
      note: t("invoicedNote", { count: data.counts.invoices }),
      value: data.kpis.invoiced,
      kind: "count",
      higherIsBetter: true,
      href: `/invoices?${period}`,
      display: show,
    },
    {
      key: "collected",
      label: t("collected"),
      note: t("collectedNote", { count: data.counts.payments }),
      value: data.kpis.collected,
      kind: "count",
      higherIsBetter: true,
      href: "/invoices?status=paid",
      display: show,
    },
    {
      key: "receivables",
      label: t("receivables"),
      note: t("receivablesNote", { overdue: show(data.kpis.overdue.value) }),
      value: data.kpis.receivables,
      kind: "count",
      higherIsBetter: false,
      href: "/invoices?status=overdue",
      display: show,
    },
  ];
  const query = {
    range: preset,
    from: preset === "custom" ? range.from : null,
    to: preset === "custom" ? range.to : null,
  };
  const points = data.series.map((s) => ({
    label: shortDate(s.bucket < range.from ? range.from : s.bucket),
    invoicedMinor: s.invoicedMinor,
    collectedMinor: s.collectedMinor,
  }));
  const hasMoney = data.series.some((s) => s.invoicedMinor || s.collectedMinor);
  return (
    <section aria-labelledby="revenue-title" className="space-y-3" data-testid="revenue">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="revenue-title" className="text-lg font-semibold tracking-tight">
          {t("title")}
        </h2>
        <CsvLink
          href={exportHref("revenue_kpis", query)}
          label={t("downloadKpis")}
          text={t("downloadKpis")}
          testId="revenue-kpis-csv"
        />
      </div>
      <KpiTiles tiles={tiles} />
      <Card>
        <CardHeader>
          <CardTitle id="chart-revenue-title" className="text-base">
            {t("chartTitle")}
          </CardTitle>
          <CardDescription id="chart-revenue-desc">
            {t("chartDescription", { bucket: range.bucket })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <figure aria-labelledby="chart-revenue-title" aria-describedby="chart-revenue-desc" className="m-0">
            {hasMoney ? (
              <RevenueChart data={points} currency={currency} names={[t("invoiced"), t("collected")]} />
            ) : (
              <p className="text-muted-foreground py-10 text-center text-sm">{t("empty")}</p>
            )}
          </figure>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <details data-testid="chart-revenue-data" className="min-w-0 flex-1">
              <summary className="text-primary cursor-pointer text-sm hover:underline">
                {t("showData")}
              </summary>
              <div className="mt-2 max-h-80 overflow-auto rounded-md border">
                <Table>
                  <caption className="sr-only">{t("chartTitle")}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t("period")}</TableHead>
                      <TableHead scope="col" className="text-right">
                        {t("invoiced")}
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        {t("collected")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.series.map((s, i) => (
                      <TableRow key={s.bucket}>
                        <TableCell>{points[i]!.label}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(s.invoicedMinor, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(s.collectedMinor, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
            <CsvLink
              href={exportHref("revenue", query)}
              label={t("downloadCsvLabel")}
              text={t("downloadCsv")}
              testId="chart-revenue-csv"
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
