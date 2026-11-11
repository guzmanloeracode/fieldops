import { dates, organization, recurrences } from "@fieldops/core";
import { CalendarClock, MapPin, UserRound } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { PriorityBadge } from "@/components/app/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay } from "@/lib/recurrence";
import { cn } from "@/lib/utils";
import type { ResolvedActor } from "@/server/context";
import { runService } from "@/server/context";
import { PlanButtons } from "./plan-buttons";
import { PlanDialog, type PlanOptions } from "./plan-dialog";

const STATUS_STYLE = {
  active:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  paused:
    "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  ended: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700",
} as const;

/** The customer's maintenance plans (JOB-13): what repeats, where, when next, and the controls. Office only. */
export async function MaintenancePlans({
  actor,
  customerId,
  sites: siteRows,
  equipment,
}: {
  actor: ResolvedActor;
  customerId: string;
  sites: { id: string; label: string }[];
  /** Equipment per site, as the customer page loaded it. */
  equipment: Map<string, { id: string; type: string; brand: string | null; model: string | null }[]>;
}) {
  const t = await getTranslations("recurrences");
  const locale = await getLocale();
  const sites: PlanOptions["sites"] = siteRows.map((s) => ({
    id: s.id,
    label: s.label,
    equipment: (equipment.get(s.id) ?? []).map((u) => ({
      id: u.id,
      label: [u.type, u.brand, u.model].filter(Boolean).join(" · "),
    })),
  }));
  const data = await runService(async (ctx) => {
    const [page, serviceTypes, members] = await Promise.all([
      recurrences.listPlans(ctx, { customer: customerId, limit: 100 }),
      organization.listServiceTypes(ctx),
      organization.listAssignableMembers(ctx),
    ]);
    return {
      plans: await recurrences.describePlans(ctx, page.rows),
      serviceTypes: serviceTypes.map((s) => ({ id: s.id, name: s.name })),
      technicians: members.filter((m) => m.role === "technician").map((m) => ({ id: m.id, name: m.name })),
    };
  }, actor);
  const options: PlanOptions = {
    sites,
    serviceTypes: data.serviceTypes,
    technicians: data.technicians,
    today: dates.localDateString(new Date(), actor.organization.timezone),
  };
  const duration = (m: number) =>
    m % 60 ? t("form.minutes", { count: m }) : t("form.hours", { count: m / 60 });

  return (
    <Card id="maintenance-plans" data-testid="maintenance-plans">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>{t("plans.title")}</CardTitle>
          <CardDescription>{t("plans.description")}</CardDescription>
        </div>
        {sites.length ? <PlanDialog customerId={customerId} options={options} /> : null}
      </CardHeader>
      <CardContent>
        {data.plans.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("plans.empty")}</p>
        ) : (
          <ul className="divide-y">
            {data.plans.map((p) => (
              <li
                key={p.id}
                id={`plan-${p.id}`}
                data-testid="plan-row"
                className="target:bg-primary/5 target:ring-primary/30 -mx-2 scroll-mt-24 space-y-2 rounded-md px-2 py-3 first:pt-1 target:ring-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-medium">{p.title}</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                      STATUS_STYLE[p.status],
                    )}
                    data-testid="plan-status"
                  >
                    {t(`plans.status.${p.status}`)}
                  </span>
                  <PriorityBadge priority={p.priority} />
                </div>
                <p className="text-sm">
                  {t("plans.rule", { unit: p.intervalUnit, count: p.intervalCount })} ·{" "}
                  {t("plans.since", { date: formatDay(p.startsOn, "long", locale) })}
                  {p.endsOn ? ` · ${t("plans.until", { date: formatDay(p.endsOn, "long", locale) })}` : ""}
                </p>
                <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <li className="inline-flex items-center gap-1">
                    <MapPin aria-hidden className="size-3" /> {p.site.label}
                    {p.serviceType ? ` · ${p.serviceType.name}` : ""}
                  </li>
                  <li className="inline-flex items-center gap-1">
                    <CalendarClock aria-hidden className="size-3" />
                    {p.windowStart && p.windowMinutes
                      ? t("plans.window", { start: p.windowStart, duration: duration(p.windowMinutes) })
                      : t("plans.noWindow")}
                    {" · "}
                    {t("plans.lead", { days: p.leadDays })}
                  </li>
                  {p.leadMember ? (
                    <li className="inline-flex items-center gap-1">
                      <UserRound aria-hidden className="size-3" />
                      {t("plans.suggested", { name: p.leadMember.name })}
                    </li>
                  ) : null}
                  {/* A plan doesn't backfill visits before it was added, so a count of zero says nothing "Next visits"
                      doesn't already show. */}
                  {p.jobCount ? <li>{t("plans.jobs", { count: p.jobCount })}</li> : null}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t("plans.next")}: </span>
                    {p.upcoming.length ? (
                      <span data-testid="plan-next">
                        {p.upcoming.map((d, i) => (
                          <span key={d}>
                            {i ? " · " : ""}
                            <time dateTime={d}>{formatDay(d, "long", locale)}</time>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span>{t("plans.noNext")}</span>
                    )}
                  </p>
                  <div className="flex items-center gap-1">
                    <PlanDialog
                      customerId={customerId}
                      options={options}
                      plan={{
                        id: p.id,
                        values: {
                          title: p.title,
                          description: p.description ?? "",
                          site_id: p.siteId,
                          equipment_id: p.equipmentId ?? "",
                          service_type_id: p.serviceTypeId ?? "",
                          priority: p.priority,
                          interval_unit: p.intervalUnit,
                          interval_count: String(p.intervalCount),
                          starts_on: p.startsOn,
                          ends_on: p.endsOn ?? "",
                          window_start: p.windowStart ?? "",
                          window_minutes: String(p.windowMinutes ?? 120),
                          lead_days: String(p.leadDays),
                          lead_member_id: p.leadMemberId ?? "",
                        },
                      }}
                    />
                    <PlanButtons
                      customerId={customerId}
                      plan={{ id: p.id, title: p.title, active: p.active, ended: p.status === "ended" }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
