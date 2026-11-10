import { can, formatJobNumber, jobs } from "@fieldops/core";
import { format } from "date-fns";
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock, Inbox, PauseCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative, formatWindow, inZone } from "@/lib/format";
import { requireActor, runService } from "@/server/context";

export const metadata: Metadata = { title: "Home" };

/** Dispatcher home for 0.1: today at a glance and the queue that needs attention. Full KPIs land in 0.2. */
export default async function DashboardPage() {
  const actor = await requireActor();
  if (!can(actor, "dashboard.operational")) redirect("/jobs?view=my-day");
  const t = await getTranslations("common");
  const tz = actor.organization.timezone;
  const today = format(inZone(new Date(), tz), "yyyy-MM-dd");

  const data = await runService(async (ctx) => {
    const base = { limit: 8, sort: "scheduled_start" } as const;
    const [todayJobs, unscheduled, inProgress, onHold, review, completedToday] = await Promise.all([
      jobs.listJobs(ctx, {
        ...base,
        from: today,
        to: today,
        page: 1,
        status: ["scheduled", "en_route", "in_progress", "on_hold", "completed"],
      }),
      jobs.listJobs(ctx, { limit: 8, sort: "-priority,created_at", status: ["new"], page: 1 }),
      jobs.listJobs(ctx, { limit: 1, sort: "-created_at", status: ["in_progress", "en_route"], page: 1 }),
      jobs.listJobs(ctx, { limit: 1, sort: "-created_at", status: ["on_hold"], page: 1 }),
      // Portal requests waiting for a dispatcher to confirm (needs_review).
      jobs
        .listJobs(ctx, { limit: 100, sort: "-created_at", status: ["new"] })
        .then((p) => p.rows.filter((j) => j.needsReview).length),
      jobs.listJobs(ctx, {
        limit: 1,
        sort: "-created_at",
        status: ["completed"],
        from: today,
        to: today,
        page: 1,
      }),
    ]);
    return {
      todayJobs,
      unscheduled,
      inProgress: inProgress.total ?? 0,
      onHold: onHold.total ?? 0,
      review,
      completedToday: completedToday.total ?? 0,
    };
  });

  const tiles = [
    {
      label: t("dashboard.today"),
      value: data.todayJobs.total ?? 0,
      icon: CalendarCheck,
      href: `/jobs?from=${today}&to=${today}&sort=scheduled_start`,
    },
    {
      label: t("dashboard.unscheduled"),
      value: data.unscheduled.total ?? 0,
      icon: Inbox,
      href: "/jobs?status=new&sort=-priority",
    },
    {
      label: t("dashboard.inProgress"),
      value: data.inProgress,
      icon: Clock,
      href: "/jobs?status=in_progress,en_route",
    },
    { label: t("dashboard.onHold"), value: data.onHold, icon: PauseCircle, href: "/jobs?status=on_hold" },
    {
      label: t("dashboard.completedToday"),
      value: data.completedToday,
      icon: CheckCircle2,
      href: `/jobs?status=completed&from=${today}&to=${today}`,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("dashboard.greeting", { name: actor.name.split(" ")[0] ?? actor.name })}
        description={t("dashboard.subtitle", { date: format(inZone(new Date(), tz), "EEEE, MMMM d") })}
        actions={
          can(actor, "jobs.create") ? (
            <Button asChild>
              <Link href="/jobs/new">{t("dashboard.newJob")}</Link>
            </Button>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(({ label, value, icon: Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="bg-card hover:border-primary/40 rounded-xl border p-4 transition-colors"
          >
            <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
              <Icon className="size-4" aria-hidden /> {label}
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </Link>
        ))}
      </div>
      {data.review > 0 ? (
        <Link
          href="/jobs?status=new&sort=-created_at"
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <AlertTriangle className="size-4" aria-hidden />{" "}
          {t("dashboard.reviewBanner", { count: data.review })}
        </Link>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t("dashboard.todaysVisits")}</CardTitle>
            <Link
              href={`/jobs?from=${today}&to=${today}&sort=scheduled_start`}
              className="text-primary text-sm hover:underline"
            >
              {t("dashboard.viewAll")}
            </Link>
          </CardHeader>
          <CardContent>
            {data.todayJobs.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("dashboard.nothingToday")}</p>
            ) : (
              <ul className="divide-y">
                {data.todayJobs.rows.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/jobs/${formatJobNumber(j.number)}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {j.title}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">
                        {formatWindow(j.scheduledStart, j.scheduledEnd, tz).split(" · ")[1]} ·{" "}
                        {j.assignees[0]?.name ?? "—"} · {j.customer.name}
                      </p>
                    </div>
                    <StatusBadge status={j.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t("dashboard.queue")}</CardTitle>
            <Link href="/jobs?status=new&sort=-priority" className="text-primary text-sm hover:underline">
              {t("dashboard.viewAll")}
            </Link>
          </CardHeader>
          <CardContent>
            {data.unscheduled.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("dashboard.queueEmpty")}</p>
            ) : (
              <ul className="divide-y">
                {data.unscheduled.rows.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/jobs/${formatJobNumber(j.number)}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {j.title}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">
                        {j.customer.name} · {t("dashboard.requested", { when: formatRelative(j.createdAt) })}
                      </p>
                    </div>
                    <PriorityBadge priority={j.priority} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
