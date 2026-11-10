import { PRIORITY_LABELS, sla, type JobView } from "@fieldops/core";
import type { SlaState, SlaTarget } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { SlaBadge } from "@/components/app/sla-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/format";
import { runService } from "@/server/context";

/** The job's response and resolution deadlines and where it stands against each (SLA-02). */
export async function SlaCard({ job, timeZone }: { job: JobView; timeZone: string }) {
  const t = await getTranslations("sla");
  const policies = await runService((ctx) => sla.listPolicies(ctx));
  const policy = policies.find((p) => p.priority === job.priority);
  const rows: { target: SlaTarget; state: SlaState | null; dueAt: Date | null; doneAt: Date | null }[] = [
    {
      target: "response",
      state: job.slaResponseState,
      dueAt: job.responseDueAt,
      doneAt: job.firstScheduledAt,
    },
    {
      target: "resolution",
      state: job.slaResolutionState,
      dueAt: job.resolutionDueAt,
      doneAt: job.status === "completed" ? job.completedAt : null,
    },
  ];
  const detail = (r: (typeof rows)[number]) => {
    if (r.doneAt && r.state === "met") return t("card.metAt", { when: formatRelative(r.doneAt) });
    if (r.doneAt) return t("card.missedAt", { when: formatRelative(r.doneAt) });
    if (!r.dueAt) return null;
    // The stored state says whether the deadline has passed (the monitor keeps it current).
    return r.state === "breached"
      ? t("card.wasDue", { when: formatRelative(r.dueAt) })
      : t("card.dueIn", { when: formatRelative(r.dueAt) });
  };
  const tracked = job.status !== "canceled" && rows.some((r) => r.dueAt);

  return (
    <Card data-testid="sla-card">
      <CardHeader>
        <CardTitle className="text-base">{t("card.title")}</CardTitle>
        {policy ? (
          <CardDescription>
            {t("card.description", {
              priority: PRIORITY_LABELS[job.priority],
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
                  {r.state ? <SlaBadge state={r.state} /> : null}
                  <span>{detail(r)}</span>
                </dd>
                {r.dueAt ? (
                  <dd className="text-muted-foreground text-xs">
                    {t("card.deadline", { date: formatDateTime(r.dueAt, timeZone) })}
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
