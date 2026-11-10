"use client";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BoardView } from "./board-data";

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** View, date and technician for the board. Everything lives in the URL so a board can be shared. */
export function BoardToolbar(props: {
  view: BoardView;
  tab: "board" | "map";
  date: string;
  today: string;
  technician: string | null;
  technicians: { id: string; name: string }[];
}) {
  const t = useTranslations("dispatch");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = (changes: Partial<Record<"view" | "tab" | "date" | "tech", string | null>>) => {
    const values = {
      view: props.view,
      tab: props.tab,
      date: props.date,
      tech: props.technician,
      ...changes,
    };
    const p = new URLSearchParams();
    if (values.view !== "day") p.set("view", values.view!);
    if (values.tab !== "board") p.set("tab", values.tab!);
    if (values.date && values.date !== props.today) p.set("date", values.date);
    if (values.tech) p.set("tech", values.tech);
    const qs = p.toString();
    return qs ? `/schedule?${qs}` : "/schedule";
  };
  const go = (changes: Parameters<typeof href>[0]) => startTransition(() => router.push(href(changes)));
  const step = props.view === "week" && props.tab === "board" ? 7 : 1;
  const segment = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <nav aria-label={t("views.label")} className="bg-muted inline-flex rounded-lg p-1">
        {(["day", "week"] as const).map((v) => (
          <Link
            key={v}
            href={href({ view: v, tab: "board" })}
            aria-current={props.view === v && props.tab === "board" ? "page" : undefined}
            className={segment(props.view === v && props.tab === "board")}
          >
            {t(`views.${v}`)}
          </Link>
        ))}
        <Link
          href={href({ tab: "map" })}
          aria-current={props.tab === "map" ? "page" : undefined}
          className={segment(props.tab === "map")}
          data-testid="board-map-tab"
        >
          {t("tabs.map")}
        </Link>
      </nav>

      <div className="flex items-center gap-1">
        <Button asChild variant="outline" size="icon" className="size-9">
          <Link
            href={href({ date: shift(props.date, -step) })}
            aria-label={step === 7 ? t("nav.previousWeek") : t("nav.previousDay")}
          >
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="h-9">
          <Link href={href({ date: props.today })}>{t("nav.today")}</Link>
        </Button>
        <Button asChild variant="outline" size="icon" className="size-9">
          <Link
            href={href({ date: shift(props.date, step) })}
            aria-label={step === 7 ? t("nav.nextWeek") : t("nav.nextDay")}
          >
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="board-date" className="text-muted-foreground text-xs">
          {t("nav.date")}
        </Label>
        <Input
          id="board-date"
          type="date"
          className="h-9 w-40"
          value={props.date}
          onChange={(e) => e.target.value && go({ date: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="board-tech" className="text-muted-foreground text-xs">
          {t("filter.technician")}
        </Label>
        <NativeSelect
          id="board-tech"
          className="w-48"
          value={props.technician ?? ""}
          onChange={(e) => go({ tech: e.target.value || null })}
        >
          <option value="">{t("filter.all")}</option>
          {props.technicians.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {pending ? <Loader2 className="text-muted-foreground mb-2 size-4 animate-spin" aria-hidden /> : null}
    </div>
  );
}
