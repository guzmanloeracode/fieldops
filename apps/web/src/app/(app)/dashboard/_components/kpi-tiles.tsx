import type { dashboard } from "@fieldops/core";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { formatCount, formatMinutes, formatPercent } from "./format";

type Comparison = dashboard.Comparison;
type Kind = "count" | "rate" | "minutes";

export interface KpiTile {
  key: string;
  label: string;
  note?: string;
  value: Comparison;
  kind: Kind;
  /** Whether a higher value is good news. */
  higherIsBetter: boolean;
  href: string;
}

function show(v: number | null, kind: Kind) {
  return kind === "rate" ? formatPercent(v) : kind === "minutes" ? formatMinutes(v) : formatCount(v);
}

/** KPI tiles with the change against the previous period (DSH-01). Each tile opens the matching jobs. */
export async function KpiTiles({ tiles }: { tiles: KpiTile[] }) {
  const t = await getTranslations("dashboard.kpi");
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map((tile) => {
        const { value, previous } = tile.value;
        let delta: { text: string; direction: "up" | "down" | "same"; good: boolean | null } | null = null;
        if (value !== null && previous !== null) {
          const diff = value - previous;
          const direction = Math.abs(diff) < 1e-9 ? "same" : diff > 0 ? "up" : "down";
          const amount =
            tile.kind === "rate"
              ? t("points", { value: Math.abs(Math.round(diff * 100)) })
              : previous === 0
                ? show(Math.abs(diff), tile.kind)
                : `${Math.abs(Math.round((diff / previous) * 100))}%`;
          delta = {
            text: direction === "same" ? t("same") : t(direction, { value: amount }),
            direction,
            good: direction === "same" ? null : (direction === "up") === tile.higherIsBetter,
          };
        }
        const Icon =
          delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
        return (
          <li key={tile.key}>
            <Link
              href={tile.href}
              data-testid={`kpi-${tile.key}`}
              className="bg-card hover:border-primary/40 focus-visible:ring-ring flex h-full flex-col gap-1 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="text-muted-foreground text-xs font-medium">{tile.label}</span>
              <span className="text-2xl font-semibold tabular-nums">{show(value, tile.kind)}</span>
              {delta ? (
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs font-medium",
                    delta.good === null
                      ? "text-muted-foreground"
                      : delta.good
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-red-700 dark:text-red-400",
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {delta.text}
                  {delta.good !== null ? (
                    <span className="sr-only">({delta.good ? t("better") : t("worse")})</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">{t("noPrevious")}</span>
              )}
              <span className="text-muted-foreground text-xs">
                {t("previous", { value: show(previous, tile.kind) })}
                {tile.note ? <> · {tile.note}</> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
