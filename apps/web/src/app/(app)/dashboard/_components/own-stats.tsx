import type { dashboard } from "@fieldops/core";
import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "./format";

/** A technician's own numbers (dashboard.own): visits completed and time on site. */
export async function OwnStats({ data }: { data: dashboard.OwnStatsOverview }) {
  const t = await getTranslations("dashboard.own");
  const locale = await getLocale();
  const tiles = [
    { key: "week-completed", label: `${t("completed")} · ${t("week")}`, value: String(data.week.completed) },
    {
      key: "month-completed",
      label: `${t("completed")} · ${t("month")}`,
      value: String(data.month.completed),
    },
    {
      key: "week-hours",
      label: `${t("hours")} · ${t("week")}`,
      value: formatMinutes(data.week.workMin, locale),
    },
    {
      key: "month-hours",
      label: `${t("hours")} · ${t("month")}`,
      value: formatMinutes(data.month.workMin, locale),
    },
  ];
  return (
    <section aria-labelledby="own-title" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="own-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Button asChild size="lg">
          <Link href="/jobs?view=my-day">
            <CalendarClock /> {t("openMyDay")}
          </Link>
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.key} className="bg-card rounded-xl border p-4" data-testid={`own-${tile.key}`}>
            <dt className="text-muted-foreground text-xs font-medium">{tile.label}</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">{tile.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
