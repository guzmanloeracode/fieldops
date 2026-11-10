"use client";
import type { JobStatus } from "@fieldops/shared";
import { MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { StatusBadge } from "@/components/app/badges";
import { Skeleton } from "@/components/ui/skeleton";
import type { BoardJob } from "./board-data";
import { STATUS_HEX } from "./block";
import { hhmm } from "./geometry";

// MapLibre is large: load it only when the map tab is open.
const MapInner = dynamic(() => import("./board-map-inner").then((m) => m.BoardMapInner), {
  ssr: false,
  loading: () => <Skeleton className="h-[28rem] w-full rounded-xl" />,
});

/** SCH-05: the day's visits on a map, colored by status, with the same list for screen readers and phones. */
export function BoardMap({ date, jobs }: { date: string; timeZone: string; jobs: BoardJob[] }) {
  const t = useTranslations("dispatch.map");
  const tStatus = useTranslations("common.status");
  const markers = useMemo(
    () =>
      jobs
        .filter((j) => j.latitude !== null && j.longitude !== null)
        .map((j) => ({
          id: j.id,
          number: j.number,
          title: j.title,
          time: `${hhmm(j.startMin)}–${hhmm(j.endMin)}`,
          technicians: j.assignees.map((a) => a.name).join(", "),
          color: STATUS_HEX[j.status],
          status: tStatus(j.status),
          latitude: j.latitude!,
          longitude: j.longitude!,
        })),
    [jobs, tStatus],
  );
  const statuses = [...new Set(jobs.map((j) => j.status))] as JobStatus[];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-2">
        {markers.length ? (
          <MapInner label={t("label", { date })} markers={markers} />
        ) : (
          <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
            {t("empty")}
          </p>
        )}
        {statuses.length ? (
          <ul aria-label={t("legend")} className="flex flex-wrap gap-3 text-xs">
            {statuses.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="size-3 rounded-full" style={{ background: STATUS_HEX[s] }} aria-hidden />
                {tStatus(s)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <section aria-labelledby="map-list" className="bg-card rounded-xl border">
        <h2 id="map-list" className="border-b px-4 py-3 text-sm font-semibold">
          {t("list", { date })}
        </h2>
        {jobs.length === 0 ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">{t("empty")}</p>
        ) : (
          <ol className="max-h-[28rem] divide-y overflow-y-auto">
            {jobs.map((j) => (
              <li key={j.id} className="px-4 py-2.5 text-sm" data-testid="map-list-item">
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">
                    {hhmm(j.startMin)}–{hhmm(j.endMin)}
                  </span>
                  <StatusBadge status={j.status} className="ml-auto" />
                </div>
                <Link href={`/jobs/${j.number}`} className="block truncate font-medium hover:underline">
                  {j.number} · {j.title}
                </Link>
                <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  {j.latitude === null ? t("noLocation") : j.site} ·{" "}
                  {j.assignees.map((a) => a.name).join(", ")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
