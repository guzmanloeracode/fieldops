import { can, dashboard, jobs, organization, ROLE_LABELS } from "@fieldops/core";
import { format } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DemoTour } from "@/components/app/demo-tour";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { inZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireActor, runService } from "@/server/context";
import { OwnStats } from "./_components/own-stats";
import { Overview } from "./_components/overview";
import { Today } from "./_components/today";
import { LiveRefresh } from "@/components/app/live-refresh";

export const metadata: Metadata = { title: "Home" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Home. Owners and admins start on the overview (KPIs and charts, DSH-01 – DSH-03), dispatchers on today's
 * operations (DSH-04); both can switch. Technicians see their own numbers and a way into My day.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const tc = await getTranslations("common");
  const t = await getTranslations("dashboard");
  const tz = actor.organization.timezone;
  const header = (
    <>
      <PageHeader
        title={tc("dashboard.greeting", { name: actor.name.split(" ")[0] ?? actor.name })}
        description={tc("dashboard.subtitle", { date: format(inZone(new Date(), tz), "EEEE, MMMM d") })}
        actions={
          can(actor, "jobs.create") ? (
            <Button asChild>
              <Link href="/jobs/new">{tc("dashboard.newJob")}</Link>
            </Button>
          ) : null
        }
      />
      {/* "Try these 5 things" for demo visitors (DEM-06). */}
      {env.DEMO_MODE && actor.isDemoUser ? (
        <div className="pb-6">
          <DemoTour role={actor.role} roleLabel={ROLE_LABELS[actor.role]} orgSlug={actor.organization.slug} />
        </div>
      ) : null}
    </>
  );

  if (!can(actor, "dashboard.operational")) {
    const own = await runService((ctx) => dashboard.getOwnStats(ctx), actor);
    return (
      <div className="space-y-6">
        {header}
        <OwnStats data={own} />
      </div>
    );
  }

  const requested = one(sp.tab);
  const tab =
    requested === "today" || requested === "overview"
      ? requested
      : actor.role === "dispatcher"
        ? "today"
        : "overview";
  const tabs = [
    { key: "overview", label: t("tabs.overview"), href: "/dashboard?tab=overview" },
    { key: "today", label: t("tabs.today"), href: "/dashboard?tab=today" },
  ];
  const nav = (
    <nav aria-label={t("tabs.label")} className="mb-6 border-b">
      <ul className="-mb-px flex gap-4">
        {tabs.map((x) => (
          <li key={x.key}>
            <Link
              href={x.href}
              aria-current={tab === x.key ? "page" : undefined}
              data-testid={`dashboard-tab-${x.key}`}
              className={cn(
                "inline-block border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
                tab === x.key
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {x.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  if (tab === "today") {
    const { today, review } = await runService(async (ctx) => {
      const [today, review] = await Promise.all([
        dashboard.getToday(ctx),
        // Portal requests waiting for a dispatcher to confirm (needs_review, AI-01).
        jobs
          .listJobs(ctx, { limit: 1, page: 1, sort: "-created_at", needs_review: true })
          .then((p) => p.total ?? 0),
      ]);
      return { today, review };
    }, actor);
    return (
      <div>
        {header}
        {nav}
        <LiveRefresh kinds={["job", "time_off", "expense"]} />
        <Today
          data={today}
          reviewCount={review}
          canApprove={can(actor, "expenses.approve", { belowDispatcherThreshold: true })}
        />
      </div>
    );
  }

  const raw = {
    range: one(sp.range),
    from: one(sp.from),
    to: one(sp.to),
    technician: one(sp.technician) || undefined,
    service_type: one(sp.service_type) || undefined,
  };
  const preset = dashboard.parseDashboardQuery(raw).range;
  const { overview, members, serviceTypes } = await runService(async (ctx) => {
    const [overview, members, serviceTypes] = await Promise.all([
      dashboard.getOverview(ctx, raw),
      organization.listAssignableMembers(ctx),
      organization.listServiceTypes(ctx),
    ]);
    return { overview, members, serviceTypes };
  }, actor);
  return (
    <div>
      {header}
      {nav}
      <Overview
        data={overview}
        preset={preset}
        technicians={members.filter((m) => m.role === "technician").map((m) => ({ id: m.id, name: m.name }))}
        serviceTypes={serviceTypes.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
