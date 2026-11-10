"use client";
import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { inZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BoardJob, BoardLane } from "./board-data";
import { DraggableBlock } from "./block";
import { BLOCK_PX, dayRange, hhmm, PX_PER_MIN, relativeTo, ROW_PX, stackRows } from "./geometry";

export interface ViewProps {
  lanes: BoardLane[];
  jobs: BoardJob[];
  timeZone: string;
  today: string;
  saving: Set<string>;
  activeId: string | null;
  resizing: { jobId: string; endMin: number } | null;
  onOpen: (job: BoardJob) => void;
  onResize: (jobId: string, laneId: string, minutes: number) => void;
}

const LABEL_W = 176;

/** Current wall-clock minutes in the organization's time zone, updated every minute (client only). */
function useNowMinutes(timeZone: string, enabled: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const [h, m] = format(inZone(new Date(), timeZone), "HH:mm").split(":").map(Number);
      setNow((h ?? 0) * 60 + (m ?? 0));
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [timeZone, enabled]);
  return enabled ? now : null;
}

/** SCH-01 day view: one lane per technician on a shared time axis; blocks sized by duration. */
export function DayView(props: ViewProps & { date: string }) {
  const t = useTranslations("dispatch");
  const [from, to] = dayRange(props.lanes, props.jobs, props.date);
  const width = (to - from) * PX_PER_MIN;
  const now = useNowMinutes(props.timeZone, props.date === props.today);
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);

  return (
    <div className="bg-card overflow-x-auto rounded-xl border" data-testid="board-day">
      <div style={{ width: LABEL_W + width }} className="relative">
        <div className="bg-card sticky top-0 z-20 flex border-b">
          <div
            className="bg-card text-muted-foreground sticky left-0 z-10 shrink-0 border-r px-3 py-2 text-xs font-medium"
            style={{ width: LABEL_W }}
          >
            {t("filter.technician")}
          </div>
          <div className="relative h-8" style={{ width }} aria-hidden>
            {hours.map((m) => (
              <span
                key={m}
                className="text-muted-foreground absolute top-2 -translate-x-1/2 text-[11px] tabular-nums first:translate-x-0 last:-translate-x-full"
                style={{ left: (m - from) * PX_PER_MIN }}
              >
                {hhmm(m)}
              </span>
            ))}
          </div>
        </div>
        {props.lanes.map((lane) => (
          <DayLane key={lane.id} {...props} lane={lane} from={from} to={to} width={width} now={now} />
        ))}
      </div>
    </div>
  );
}

function DayLane(
  props: ViewProps & {
    date: string;
    lane: BoardLane;
    from: number;
    to: number;
    width: number;
    now: number | null;
  },
) {
  const t = useTranslations("dispatch");
  const { lane, date, from, to } = props;
  const day = lane.days.find((d) => d.date === date);
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${lane.id}`,
    data: { type: "lane", laneId: lane.id, date },
  });
  const items = props.jobs
    .filter((j) => j.assignees.some((a) => a.memberId === lane.id))
    .map((j) => {
      const r = relativeTo(j, date);
      const end = props.resizing?.jobId === j.id ? r.start + (props.resizing.endMin - j.startMin) : r.end;
      return { id: j.id, job: j, start: r.start, end };
    })
    .filter((i) => i.end > 0 && i.start < 1440);
  const { rows, count } = stackRows(items);
  const height = count * ROW_PX + 8;
  const x = (m: number) => (Math.min(Math.max(m, from), to) - from) * PX_PER_MIN;
  const hoursText = day?.hours.length
    ? day.hours.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(", ")
    : t("lane.dayOff");

  return (
    <div className="flex border-b last:border-b-0">
      <div
        className="bg-card sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r px-3 py-2"
        style={{ width: LABEL_W }}
      >
        <p className="truncate text-sm font-medium">{lane.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {t("lane.visits", { count: items.length })} · {hoursText}
        </p>
      </div>
      <div
        id={`lane-${lane.id}`}
        ref={setNodeRef}
        data-from={from}
        role="group"
        aria-label={t("lane.label", { name: lane.name })}
        className={cn("bg-muted/60 relative", isOver && "ring-primary ring-2 ring-inset")}
        style={{ width: props.width, height }}
      >
        {day?.hours.map(([a, b]) => (
          <div
            key={a}
            className="bg-background absolute inset-y-0"
            style={{ left: x(a), width: x(b) - x(a) }}
            aria-hidden
          />
        ))}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, var(--border) 0, var(--border) 1px, transparent 1px, transparent 96px)",
          }}
          aria-hidden
        />
        {day?.off.map((o) => (
          <div
            key={`${o.startMin}-${o.endMin}`}
            className="absolute inset-y-0 border-x border-amber-300 bg-amber-100/80 px-2 py-1 text-[11px] font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100"
            style={{
              left: x(o.startMin),
              width: x(o.endMin) - x(o.startMin),
              backgroundImage:
                "repeating-linear-gradient(135deg, transparent 0 8px, rgb(251 191 36 / 0.25) 8px 16px)",
            }}
          >
            <span className="sticky left-2">
              {o.reason ? t("lane.offReason", { reason: o.reason }) : t("lane.off")}
            </span>
          </div>
        ))}
        {props.now !== null && props.now >= from && props.now <= to ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-red-600"
            style={{ left: x(props.now) }}
            aria-hidden
          />
        ) : null}
        {items.map((i) => {
          const left = x(i.start);
          const w = Math.max(x(i.end) - left, 15 * PX_PER_MIN) - 2;
          return (
            <DraggableBlock
              key={i.id}
              job={i.job}
              laneId={lane.id}
              style={{ left, width: w, top: 4 + (rows.get(i.id) ?? 0) * ROW_PX, height: BLOCK_PX, zIndex: 5 }}
              dimmed={props.activeId === i.id}
              saving={props.saving.has(i.id)}
              resizable={i.job.status !== "completed" && i.job.status !== "canceled"}
              onOpen={props.onOpen}
              onResize={props.onResize}
            />
          );
        })}
      </div>
    </div>
  );
}
