"use client";
import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { BoardLane } from "./board-data";
import { DraggableBlock } from "./block";
import type { ViewProps } from "./day-view";
import { hhmm } from "./geometry";

const label = (date: string, pattern: string) => format(new Date(`${date}T12:00:00Z`), pattern);

/** SCH-01 week view: technicians × seven days, with compact job cards in time order. */
export function WeekView(props: ViewProps & { dates: string[] }) {
  const t = useTranslations("dispatch");
  return (
    <div className="bg-card overflow-x-auto rounded-xl border" data-testid="board-week">
      <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
        <caption className="sr-only">{t("title")}</caption>
        <thead>
          <tr className="border-b">
            <th
              scope="col"
              className="text-muted-foreground w-44 border-r px-3 py-2 text-left text-xs font-medium"
            >
              {t("filter.technician")}
            </th>
            {props.dates.map((d) => (
              <th
                key={d}
                scope="col"
                className={cn(
                  "border-r px-2 py-2 text-left text-xs font-medium last:border-r-0",
                  d === props.today ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="block">{label(d, "EEE")}</span>
                <span className="text-foreground text-sm font-semibold">{label(d, "MMM d")}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.lanes.map((lane) => (
            <tr key={lane.id} className="border-b last:border-b-0">
              <th scope="row" className="border-r px-3 py-2 text-left align-top font-medium">
                <span className="block truncate">{lane.name}</span>
                <span className="text-muted-foreground block text-xs font-normal">
                  {t("lane.visits", {
                    count: props.jobs.filter(
                      (j) =>
                        j.date &&
                        props.dates.includes(j.date) &&
                        j.assignees.some((a) => a.memberId === lane.id),
                    ).length,
                  })}
                </span>
              </th>
              {props.dates.map((d) => (
                <WeekCell key={d} {...props} lane={lane} date={d} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekCell(props: ViewProps & { lane: BoardLane; date: string }) {
  const t = useTranslations("dispatch");
  const { lane, date } = props;
  const day = lane.days.find((d) => d.date === date);
  const dayOff = !day?.hours.length;
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${lane.id}:${date}`,
    data: { type: "cell", laneId: lane.id, date },
  });
  const jobs = props.jobs
    .filter((j) => j.date === date && j.assignees.some((a) => a.memberId === lane.id))
    .sort((a, b) => a.startMin - b.startMin);
  return (
    <td className="border-r p-0 align-top last:border-r-0">
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-24 space-y-1 p-1",
          dayOff && "bg-muted/60",
          isOver && "ring-primary ring-2 ring-inset",
        )}
        aria-label={`${lane.name}, ${label(date, "EEEE MMM d")}`}
        role="group"
      >
        {day?.hours.length ? (
          <p className="text-muted-foreground px-1 text-[11px] tabular-nums">
            {day.hours.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(", ")}
          </p>
        ) : (
          <p className="text-muted-foreground px-1 text-[11px]">{t("lane.dayOff")}</p>
        )}
        {day?.off.map((o) => (
          <p
            key={o.startMin}
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100"
          >
            {o.reason ? t("lane.offReason", { reason: o.reason }) : t("lane.off")}
          </p>
        ))}
        {jobs.map((j) => (
          <DraggableBlock
            key={j.id}
            job={j}
            laneId={lane.id}
            compact
            dimmed={props.activeId === j.id}
            saving={props.saving.has(j.id)}
            onOpen={props.onOpen}
            onResize={props.onResize}
          />
        ))}
      </div>
    </td>
  );
}
