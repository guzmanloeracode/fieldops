import { formatJobNumber, jobs, type JobView } from "@fieldops/core";
import { addDays, format } from "date-fns";
import { CalendarClock, ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { formatWindow, inZone } from "@/lib/format";
import { runService, type ResolvedActor } from "@/server/context";

/**
 * Phone-first list of the signed-in technician's visits: today in time order, then the next seven days
 * (TEC-01 groundwork; the full technician workspace arrives in 0.2).
 */
export async function MyDay({ actor }: { actor: ResolvedActor }) {
  const t = await getTranslations("jobs");
  const tz = actor.organization.timezone;
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
    return {
      today: todayPage.rows.filter((j) => j.scheduledStart),
      upcoming: upcoming.rows.filter((j) => j.scheduledStart),
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("myDay")} description={format(now, "EEEE, MMMM d")} />
      <section aria-labelledby="today-heading" className="space-y-3">
        <h2 id="today-heading" className="text-muted-foreground text-sm font-medium">
          {t("myDayToday", { count: data.today.length })}
        </h2>
        {data.today.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title={t("emptyMyDay")} />
        ) : (
          <ul className="space-y-3">
            {data.today.map((j) => (
              <JobCard key={j.id} job={j} timeZone={tz} timeOnly />
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
}: {
  job: JobView;
  timeZone: string;
  timeOnly?: boolean;
}) {
  const window = formatWindow(job.scheduledStart, job.scheduledEnd, timeZone);
  return (
    <li data-testid="job-row">
      <Link
        href={`/jobs/${formatJobNumber(job.number)}`}
        className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-xl border p-4 transition-colors"
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
