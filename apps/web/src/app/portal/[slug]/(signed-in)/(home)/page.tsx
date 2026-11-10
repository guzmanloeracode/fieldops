import { formatJobNumber, portal } from "@fieldops/core";
import { CalendarClock, ChevronRight, ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, formatWindow } from "@/lib/format";
import { getPortalOrg, requirePortal, runPortal } from "@/server/portal/session";
import { PortalStatus } from "../status";
import { PortalBillingSummary } from "./billing-summary";

/** The customer's jobs (POR-03): open ones with their visit window and technician, then the past ones. */
export default async function PortalHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { actor } = await requirePortal(slug);
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("portal.home");
  const jobs = await runPortal(slug, (ctx) => portal.listPortalJobs(ctx));
  const isOpen = (s: string) => s !== "completed" && s !== "canceled";
  const open = jobs.filter((j) => isOpen(j.status));
  const past = jobs.filter((j) => !isOpen(j.status));
  const tz = org.timezone;
  const row = (j: (typeof jobs)[number]) => (
    <li key={j.id}>
      <Link
        href={`/portal/${slug}/jobs/${j.number}`}
        className="bg-card hover:bg-accent/50 focus-visible:ring-ring flex items-start gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        data-testid="portal-job"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs">{formatJobNumber(j.number)}</span>
            <PortalStatus status={j.status} />
          </div>
          <p className="font-medium">{j.title}</p>
          <p className="text-muted-foreground text-sm">
            {j.status === "completed" && j.completedAt
              ? t("completedOn", { date: formatDate(j.completedAt, tz) })
              : j.scheduledStart && isOpen(j.status)
                ? formatWindow(j.scheduledStart, j.scheduledEnd, tz)
                : isOpen(j.status)
                  ? t("notScheduled")
                  : t("requestedOn", { date: formatDate(j.createdAt, tz) })}
          </p>
          {j.technicianFirstName && isOpen(j.status) ? (
            <p className="text-muted-foreground text-sm">
              {t("technician", { name: j.technicianFirstName })}
            </p>
          ) : null}
          <p className="text-muted-foreground truncate text-xs">
            {j.site.label} · {j.site.line1}, {j.site.city}
          </p>
        </div>
        <ChevronRight aria-hidden className="text-muted-foreground mt-1 size-4 shrink-0" />
        <span className="sr-only">{t("details", { number: formatJobNumber(j.number) })}</span>
      </Link>
    </li>
  );
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("greeting", { name: actor.contactName })}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description", { org: org.name })}</p>
        </div>
        <Button asChild data-testid="portal-new-request">
          <Link href={`/portal/${slug}/request`}>
            <Plus aria-hidden /> {t("request")}
          </Link>
        </Button>
      </div>
      <PortalBillingSummary slug={slug} />
      <section aria-labelledby="open-jobs" className="space-y-3">
        <h2 id="open-jobs" className="flex items-center gap-2 text-base font-semibold">
          <CalendarClock aria-hidden className="size-4" /> {t("open")}
        </h2>
        {open.length ? (
          <ul className="space-y-3">{open.map(row)}</ul>
        ) : (
          <EmptyState icon={<ClipboardList />} title={t("empty")} description={t("emptyHint")} />
        )}
      </section>
      <section aria-labelledby="past-jobs" className="space-y-3">
        <h2 id="past-jobs" className="text-base font-semibold">
          {t("past")}
        </h2>
        {past.length ? (
          <ul className="space-y-3">{past.map(row)}</ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noPast")}</p>
        )}
      </section>
    </div>
  );
}
