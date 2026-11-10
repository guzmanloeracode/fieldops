import { sla, type JobView } from "@fieldops/core";
import type { SlaTarget } from "@fieldops/shared";
import { getLocale, getTranslations } from "next-intl/server";
import { SlaBadge, type SlaBadgeState } from "@/components/app/sla-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/format";
import { formatPause } from "@/lib/recurrence";
import { runService } from "@/server/context";

/** The job's response and resolution deadlines and where it stands against each (SLA-02). */
export async function SlaCard({ job, timeZone }: { job: JobView; timeZone: string }) {
  const t = await getTranslations("sla");
  const locale = await getLocale();
  const tp = await getTranslations("common.priority");
  const tr = await getTranslations("recurrences");
  const policies = await runService((ctx) => sla.listPolicies(ctx));
  const policy = policies.find((p) => p.priority === job.priority);
  const rows: { target: SlaTarget; state: SlaBadgeState | null; dueAt: Date | null; doneAt: Date | null }[] =
    [
      {
        target: "response",
        state: job.slaResponseState,
        dueAt: job.responseDueAt,
        doneAt: job.firstScheduledAt,
      },
      {
        target: "resolution",
        // SLA-04: waiting for the customer stops the resolution clock.
        state: job.slaPausedAt ? "paused" : job.slaResolutionState,
        dueAt: job.resolutionDueAt,
        doneAt: job.status === "completed" ? job.completedAt : null,
      },
    ];
  const pausedNote = job.slaPausedAt
    ? tr("slaPause.card", { when: formatDateTime(job.slaPausedAt, timeZone, locale) })
    : null;
  const detail = (r: (typeof rows)[number]) => {
    if (r.state === "paused") return pausedNote;
    if (r.doneAt && r.state === "met") return t("card.metAt", { when: formatRelative(r.doneAt, locale) });
    if (r.doneAt) return t("card.missedAt", { when: formatRelative(r.doneAt, locale) });
    if (!r.dueAt) return null;
    // The stored state says whether the deadline has passed (the monitor keeps it current).
    return r.state === "breached"
      ? t("card.wasDue", { when: formatRelative(r.dueAt, locale) })
      : t("card.dueIn", { when: formatRelative(r.dueAt, locale) });
  };
  const tracked = job.status !== "canceled" && rows.some((r) => r.dueAt);

  return (
    <Card data-testid="sla-card">
      <CardHeader>
        <CardTitle className="text-base">{t("card.title")}</CardTitle>
        {policy ? (
          <CardDescription>
            {t("card.description", {
              priority: tp(job.priority),
              basis: policy.businessHours ? t("card.businessHours") : t("card.calendar"),
            })}
            {policy.isDefault ? ` · ${t("card.defaults")}` : ""}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {!tracked ? (
          <p className="text-muted-foreground text-sm">
            {job.status === "canceled" ? t("card.notTracked") : t("card.none")}
          </p>
        ) : (
          <dl className="space-y-3 text-sm">
            {rows.map((r) => (
              <div key={r.target} data-testid={`sla-${r.target}`} className="space-y-1">
                <dt className="text-muted-foreground text-xs">{t(`targetLong.${r.target}`)}</dt>
                <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {r.state ? (
                    <SlaBadge
                      state={r.state}
                      title={r.state === "paused" ? (pausedNote ?? undefined) : undefined}
                    />
                  ) : null}
                  <span>{detail(r)}</span>
                </dd>
                {r.dueAt ? (
                  <dd className="text-muted-foreground text-xs">
                    {t("card.deadline", { date: formatDateTime(r.dueAt, timeZone, locale) })}
                  </dd>
                ) : null}
                {r.target === "resolution" && job.slaPausedMinutes > 0 ? (
                  <dd className="text-muted-foreground text-xs" data-testid="sla-paused-total">
                    {tr("slaPause.total", { duration: formatPause(tr, job.slaPausedMinutes) })}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
