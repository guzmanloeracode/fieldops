import { formatJobNumber, jobs, type JobView } from "@fieldops/core";
import { useLocale } from "next-intl";
import { addDays, format } from "date-fns";
import { CalendarClock, ChevronRight, MapPin, Navigation } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { formatDay, formatWindow, inZone } from "@/lib/format";
import { runService, type ResolvedActor } from "@/server/context";
import { QuickAction } from "./quick-action";

const ACTIVE = new Set(["scheduled", "en_route", "in_progress", "on_hold"]);
const QUICK = new Set(["depart", "start", "resume"]);

/** Directions link: coordinates when known, otherwise the address. */
function mapsUrl(job: JobView): string {
  const destination =
    job.site.latitude !== null && job.site.longitude !== null
      ? `${job.site.latitude},${job.site.longitude}`
      : [job.site.address.line1, job.site.address.city, job.site.address.postal_code]
          .filter(Boolean)
          .join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/**
 * Phone-first list of the signed-in technician's visits (TEC-01): the next visit on top with one-tap
 * actions and directions, then today in time order, then the next seven days.
 */
export async function MyDay({ actor }: { actor: ResolvedActor }) {
  const t = await getTranslations("jobs");
  const tf = await getTranslations("fieldwork.myDay");
  const tz = actor.organization.timezone;
  const locale = await getLocale();
  const now = inZone(new Date(), tz);
  const today = format(now, "yyyy-MM-dd");
  const tomorrow = format(addDays(now, 1), "yyyy-MM-dd");
  const weekEnd = format(addDays(now, 7), "yyyy-MM-dd");

  const data = await runService(async (ctx) => {
    // Office roles see their own assignments here too.
    const mine = { technician: actor.memberId, sort: "scheduled_start", limit: 50 } as const;
    const [todayPage, upcoming] = await Promise.all([
      jobs.listJobs(ctx, { ...mine, from: today, to: today }),
      jobs.listJobs(ctx, {
        ...mine,
        from: tomorrow,
        to: weekEnd,
        status: ["scheduled", "en_route", "in_progress", "on_hold"],
      }),
    ]);
    const todays = todayPage.rows.filter((j) => j.scheduledStart);
    // The visit in progress first, otherwise the earliest one still to do.
    const next =
      todays.find((j) => j.status === "en_route" || j.status === "in_progress") ??
      todays.find((j) => ACTIVE.has(j.status)) ??
      null;
    const quick = next ? (await jobs.getJobActions(ctx, next)).find((a) => QUICK.has(a.name)) : undefined;
    return {
      today: todays,
      upcoming: upcoming.rows.filter((j) => j.scheduledStart),
      next,
      quick: quick ? { to: quick.to, name: quick.name as "depart" | "start" | "resume" } : null,
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("myDay")} description={formatDay(now, tz, locale)} />
      {data.next ? (
        <section aria-labelledby="next-heading" className="mb-8 space-y-3">
          <h2 id="next-heading" className="text-muted-foreground text-sm font-medium">
            {tf(data.next.status === "in_progress" || data.next.status === "en_route" ? "current" : "next")}
          </h2>
          <div
            className="border-primary bg-card space-y-3 rounded-xl border-2 p-4 shadow-sm"
            data-testid="next-visit"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">
                {formatWindow(data.next.scheduledStart, data.next.scheduledEnd, tz, locale).split(" · ")[1]}
              </span>
              <StatusBadge status={data.next.status} />
              {data.next.priority === "high" || data.next.priority === "urgent" ? (
                <PriorityBadge priority={data.next.priority} />
              ) : null}
            </div>
            <div>
              <h3 className="text-lg font-semibold">
                <Link
                  href={`/jobs/${formatJobNumber(data.next.number)}`}
                  className="underline-offset-2 hover:underline"
                >
                  {data.next.title}
                </Link>
              </h3>
              <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {data.next.customer.name} · {data.next.site.address.line1}, {data.next.site.address.city}
                </span>
              </p>
              {data.next.site.accessNotes ? (
                <p className="bg-muted mt-2 rounded-md p-2 text-xs">{data.next.site.accessNotes}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {data.quick ? (
                <QuickAction
                  jobId={data.next.id}
                  version={data.next.version}
                  to={data.quick.to}
                  name={data.quick.name}
                />
              ) : null}
              <Button asChild size="lg" variant="outline" className="h-12 flex-1 text-base sm:flex-none">
                <a href={mapsUrl(data.next)} target="_blank" rel="noreferrer">
                  <Navigation /> {tf("directions")}
                </a>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 flex-1 text-base sm:flex-none">
                <Link href={`/jobs/${formatJobNumber(data.next.number)}`}>
                  {tf("openJob")} <ChevronRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      <section aria-labelledby="today-heading" className="space-y-3">
        <h2 id="today-heading" className="text-muted-foreground text-sm font-medium">
          {t("myDayToday", { count: data.today.length })}
        </h2>
        {data.today.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title={t("emptyMyDay")} />
        ) : (
          <ul className="space-y-3">
            {data.today.map((j) => (
              <JobCard key={j.id} job={j} timeZone={tz} timeOnly current={j.id === data.next?.id} />
            ))}
          </ul>
        )}
      </section>
      {data.upcoming.length ? (
        <section aria-labelledby="upcoming-heading" className="mt-8 space-y-3">
          <h2 id="upcoming-heading" className="text-muted-foreground text-sm font-medium">
            {t("myDayUpcoming")}
          </h2>
          <ul className="space-y-3">
            {data.upcoming.map((j) => (
              <JobCard key={j.id} job={j} timeZone={tz} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function JobCard({
  job,
  timeZone,
  timeOnly = false,
  current = false,
}: {
  job: JobView;
  timeZone: string;
  timeOnly?: boolean;
  current?: boolean;
}) {
  const locale = useLocale();
  const window = formatWindow(job.scheduledStart, job.scheduledEnd, timeZone, locale);
  return (
    <li data-testid="job-row">
      <Link
        href={`/jobs/${formatJobNumber(job.number)}`}
        aria-current={current ? "true" : undefined}
        className={
          "bg-card hover:border-primary/40 flex min-h-16 items-center gap-3 rounded-xl border p-4 transition-colors" +
          (current ? " border-primary/60" : "")
        }
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">
              {timeOnly ? (window.split(" · ")[1] ?? window) : window}
            </span>
            <StatusBadge status={job.status} />
            {job.priority === "high" || job.priority === "urgent" ? (
              <PriorityBadge priority={job.priority} />
            ) : null}
          </div>
          <p className="truncate font-medium">{job.title}</p>
          <p className="text-muted-foreground flex items-start gap-1.5 text-sm">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">
              {job.customer.name} · {job.site.address.line1}, {job.site.address.city}
            </span>
          </p>
        </div>
        <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden />
      </Link>
    </li>
  );
}
