import { formatJobNumber, formatMoney, type dashboard } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";
import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { SlaBadge } from "@/components/app/sla-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative, intlLocale } from "@/lib/format";
import { jobsHref } from "@/lib/drilldown";
import { formatMinutes, formatPercent } from "./format";
import { CsvLink, exportHref } from "./overview";

/** Dispatcher home (DSH-04): today's board, the queue, at-risk jobs and pending approvals. */
export async function Today({
  data,
  reviewCount,
  canApprove,
}: {
  data: dashboard.TodayOverview;
  reviewCount: number;
  canApprove: boolean;
}) {
  const t = await getTranslations("dashboard.today");
  const locale = await getLocale();
  const tsla = await getTranslations("sla");
  const csv = (report: string, title: string) => ({
    href: exportHref(report),
    label: t("downloadCsvLabel", { report: title }),
    text: t("downloadCsv"),
    testId: `today-${report.replace(/_/g, "-")}-csv`,
  });
  const riskHref = jobsHref({
    sla: "at_risk,breached",
    status: "new,scheduled,en_route,in_progress,on_hold",
    sort: "scheduled_start",
  });
  const day = { from: data.date, to: data.date };
  const c = data.statusCounts;
  const tiles = [
    {
      key: "scheduled",
      label: t("scheduled"),
      value: data.scheduledTotal,
      href: jobsHref({ ...day, sort: "scheduled_start" }),
    },
    {
      key: "active",
      label: t("active"),
      value: c.en_route + c.in_progress,
      href: jobsHref({ ...day, status: "en_route,in_progress", sort: "scheduled_start" }),
    },
    {
      key: "completed",
      label: t("completed"),
      value: c.completed,
      href: jobsHref({ ...day, status: "completed" }),
    },
    { key: "on-hold", label: t("onHold"), value: c.on_hold, href: jobsHref({ ...day, status: "on_hold" }) },
    {
      key: "unassigned",
      label: t("unassigned"),
      value: data.unassigned.total,
      href: jobsHref({ status: "new", unassigned: true, sort: "-priority" }),
    },
    { key: "at-risk", label: t("atRisk"), value: data.atRisk.total, href: riskHref },
    ...(canApprove
      ? [{ key: "approvals", label: t("approvals"), value: data.approvals.total, href: "/approvals" }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((tile) => (
          <li key={tile.key}>
            <Link
              href={tile.href}
              data-testid={`today-${tile.key}`}
              className="bg-card hover:border-primary/40 block h-full rounded-xl border p-4 transition-colors"
            >
              <span className="text-muted-foreground block text-xs font-medium">{tile.label}</span>
              <span className="mt-2 block text-2xl font-semibold tabular-nums">{tile.value}</span>
            </Link>
          </li>
        ))}
      </ul>

      {reviewCount > 0 ? (
        <Link
          href="/jobs?needs_review=true&sort=-created_at"
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <AlertTriangle className="size-4" aria-hidden /> {t("reviewBanner", { count: reviewCount })}
        </Link>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{t("technicians")}</CardTitle>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/schedule">
                {t("openBoard")} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {data.technicians.map((m) => {
                const pct = m.utilization === null ? 0 : Math.min(1, m.utilization);
                return (
                  <li key={m.memberId} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link
                        href={jobsHref({ technician: m.memberId, ...day, sort: "scheduled_start" })}
                        className="font-medium hover:underline"
                      >
                        {m.name}
                      </Link>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {m.availableMin === 0 && m.jobs === 0
                          ? t("off")
                          : `${t("techLine", {
                              jobs: m.jobs,
                              scheduled: formatMinutes(m.scheduledMin, locale),
                              working: formatMinutes(m.availableMin, locale),
                            })} · ${formatPercent(m.utilization, locale)}`}
                      </span>
                    </div>
                    <div aria-hidden className="bg-muted h-1.5 overflow-hidden rounded-full">
                      <div
                        className={(m.utilization ?? 0) > 1 ? "h-full bg-orange-500" : "bg-primary h-full"}
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="pt-3">
              <CsvLink {...csv("technicians_today", t("technicians"))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{t("queue")}</CardTitle>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href={jobsHref({ status: "new", unassigned: true, sort: "-priority" })}>
                {t("viewAll")}
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.unassigned.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("queueEmpty")}</p>
            ) : (
              <ul className="divide-y">
                {data.unassigned.rows.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/jobs/${formatJobNumber(j.number)}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {j.title}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">
                        {j.customer.name} · {t("requested", { when: formatRelative(j.createdAt, locale) })}
                      </p>
                    </div>
                    <PriorityBadge priority={j.priority} />
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-3">
              <CsvLink {...csv("unassigned", t("queue"))} />
            </div>
          </CardContent>
        </Card>

        <Card id="at-risk">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">
                {t("risk")} <span className="text-muted-foreground font-normal">({data.atRisk.total})</span>
              </CardTitle>
              <CardDescription>{t("riskNote")}</CardDescription>
            </div>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href={riskHref}>{t("viewRisk")}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.atRisk.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("riskEmpty")}</p>
            ) : (
              <ul className="divide-y" data-testid="at-risk-list">
                {data.atRisk.rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/jobs/${formatJobNumber(r.number)}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {r.title}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">
                        {r.dueAt
                          ? t(r.state === "breached" ? "wasDue" : "dueIn", {
                              target: tsla(`target.${r.target}`),
                              when: formatRelative(r.dueAt, locale),
                            })
                          : tsla(`target.${r.target}`)}{" "}
                        · {r.customerName}
                        {r.assignees.length ? ` · ${r.assignees.join(", ")}` : ""}
                      </p>
                    </div>
                    <SlaBadge state={r.state} prefixed />
                    <StatusBadge status={r.status} className="hidden sm:inline-flex" />
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-3">
              <CsvLink {...csv("at_risk", t("risk"))} />
            </div>
          </CardContent>
        </Card>

        {canApprove ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">
                {t("approvalsTitle")}{" "}
                <span className="text-muted-foreground font-normal">({data.approvals.total})</span>
              </CardTitle>
              <Button asChild variant="link" size="sm" className="px-0">
                <Link href="/approvals">{t("openApprovals")}</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {data.approvals.rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("approvalsEmpty")}</p>
              ) : (
                <ul className="divide-y">
                  {data.approvals.rows.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.item}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {t("requestedBy", {
                            name: a.requesterName ?? "—",
                            job: formatJobNumber(a.jobNumber),
                          })}{" "}
                          · {formatRelative(a.createdAt, locale)}
                        </p>
                      </div>
                      <span className="text-sm font-medium tabular-nums">
                        {formatMoney(
                          { amountMinor: a.totalMinor, currency: a.currency as Currency },
                          intlLocale(locale),
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="pt-3">
                <CsvLink {...csv("approvals", t("approvalsTitle"))} />
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
