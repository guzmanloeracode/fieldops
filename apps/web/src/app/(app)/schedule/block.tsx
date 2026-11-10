"use client";
import { useDraggable } from "@dnd-kit/core";
import { PRIORITY_LABELS, STATUS_LABELS } from "@fieldops/core";
import type { JobStatus } from "@fieldops/shared";
import { AlertTriangle, ArrowUp, ChevronsUp, Loader2, Star, Users, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { DragData } from "./board";
import type { BoardJob } from "./board-data";
import { hhmm, STEP_MIN } from "./geometry";

/** Block colors per status: a tinted background and a strong left border. Text stays at full contrast. */
export const BLOCK_STYLES: Record<JobStatus, string> = {
  new: "bg-slate-50 border-l-slate-500 dark:bg-slate-900",
  scheduled: "bg-sky-50 border-l-sky-600 dark:bg-sky-950",
  en_route: "bg-indigo-50 border-l-indigo-600 dark:bg-indigo-950",
  in_progress: "bg-amber-50 border-l-amber-500 dark:bg-amber-950",
  on_hold: "bg-orange-50 border-l-orange-600 dark:bg-orange-950",
  completed: "bg-emerald-50 border-l-emerald-600 dark:bg-emerald-950",
  canceled: "bg-zinc-100 border-l-zinc-400 dark:bg-zinc-900",
};

/** Map marker colors (hex) matching the block colors. */
export const STATUS_HEX: Record<JobStatus, string> = {
  new: "#64748b",
  scheduled: "#0284c7",
  en_route: "#4f46e5",
  in_progress: "#d97706",
  on_hold: "#ea580c",
  completed: "#059669",
  canceled: "#a1a1aa",
};

function PriorityMark({ job }: { job: BoardJob }) {
  if (job.priority !== "high" && job.priority !== "urgent") return null;
  const Icon = job.priority === "urgent" ? ChevronsUp : ArrowUp;
  return (
    <Icon
      className={cn(
        "size-3.5 shrink-0",
        job.priority === "urgent" ? "text-red-700 dark:text-red-400" : "text-orange-700 dark:text-orange-400",
      )}
      aria-hidden
    />
  );
}

/** At risk or breached SLA (SLA-02): an icon on the block; the text is in the block's accessible details. */
function SlaMark({ job }: { job: BoardJob }) {
  if (!job.sla) return null;
  const Icon = job.sla.state === "breached" ? XCircle : AlertTriangle;
  return (
    <Icon
      data-testid="block-sla"
      data-sla={job.sla.state}
      className={cn(
        "size-3.5 shrink-0",
        job.sla.state === "breached"
          ? "text-red-700 dark:text-red-400"
          : "text-amber-700 dark:text-amber-400",
      )}
      aria-hidden
    />
  );
}

function RoleMark({ job, laneId }: { job: BoardJob; laneId?: string }) {
  if (!laneId || job.assignees.length < 2) return null;
  const lead = job.assignees.find((a) => a.memberId === laneId)?.isLead;
  return lead ? (
    <Star className="size-3 shrink-0 fill-current" aria-hidden />
  ) : (
    <Users className="size-3 shrink-0" aria-hidden />
  );
}

/** What a job looks like on the board, in the queue and under the pointer while dragging. */
export function BlockCard({
  job,
  laneId,
  compact = false,
  overlay = false,
  width,
  className,
}: {
  job: BoardJob;
  laneId?: string;
  compact?: boolean;
  overlay?: boolean;
  width?: number;
  className?: string;
}) {
  // Day view: the full window. Compact (week view, queue): the start only, so the number still fits.
  const time = job.date
    ? compact
      ? hhmm(job.startMin)
      : `${hhmm(job.startMin)}–${hhmm(job.endMin)}`
    : `${job.durationMin} min`;
  return (
    <div
      className={cn(
        "text-foreground overflow-hidden rounded-md border border-l-4 px-2 py-1 text-xs leading-tight",
        BLOCK_STYLES[job.status],
        overlay && "ring-primary/50 shadow-lg ring-2",
        className,
      )}
      style={width ? { width } : undefined}
    >
      <div className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
        <SlaMark job={job} />
        <PriorityMark job={job} />
        <RoleMark job={job} laneId={laneId} />
        <span className="font-semibold tabular-nums">{time}</span>
        <span className="text-muted-foreground truncate">{job.number}</span>
      </div>
      <p className="truncate font-medium">{job.title}</p>
      {compact ? <p className="text-muted-foreground truncate">{job.customer}</p> : null}
    </div>
  );
}

/**
 * A draggable job on the board. Pointer: drag to move, drag the right edge to resize, click for details.
 * Keyboard: Space picks it up (arrows move, Space/Enter drops), Shift+←/→ changes the end by 15 minutes,
 * Enter opens the details dialog.
 */
export function DraggableBlock({
  job,
  laneId,
  style,
  compact = false,
  dimmed = false,
  saving = false,
  resizable = false,
  onOpen,
  onResize,
}: {
  job: BoardJob;
  laneId: string;
  style?: CSSProperties;
  compact?: boolean;
  dimmed?: boolean;
  saving?: boolean;
  resizable?: boolean;
  onOpen: (job: BoardJob) => void;
  onResize: (jobId: string, laneId: string, minutes: number) => void;
}) {
  const t = useTranslations("dispatch");
  const tsla = useTranslations("sla");
  const data: DragData = { type: "job", jobId: job.id, laneId };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `job:${job.id}:${laneId}`,
    data,
  });
  const resize = useDraggable({
    id: `resize:${job.id}:${laneId}`,
    data: { type: "resize", jobId: job.id, laneId } satisfies DragData,
    disabled: !resizable,
  });
  const role =
    job.assignees.length > 1
      ? job.assignees.find((a) => a.memberId === laneId)?.isLead
        ? t("lane.lead")
        : t("lane.helper")
      : null;
  // The accessible name is the visible text plus these details (WCAG 2.5.3: the label contains the text).
  const details = [
    compact ? null : job.customer,
    STATUS_LABELS[job.status],
    job.priority === "high" || job.priority === "urgent" ? PRIORITY_LABELS[job.priority] : null,
    job.sla ? tsla(`short.${job.sla.state}`) : null,
    role,
  ]
    .filter(Boolean)
    .join(", ");

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(e);
    if (e.defaultPrevented || isDragging) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(job);
    } else if (resizable && e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      onResize(job.id, laneId, e.key === "ArrowRight" ? STEP_MIN : -STEP_MIN);
    }
  };

  return (
    <div
      className={cn("group", style ? "absolute" : "relative")}
      style={style}
      data-testid="board-block"
      data-job={job.number}
      data-lane={laneId}
    >
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        onClick={() => onOpen(job)}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpen(job);
        }}
        className={cn(
          "focus-visible:ring-ring h-full cursor-grab rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-1 active:cursor-grabbing",
          (dimmed || isDragging) && "opacity-40",
        )}
      >
        <BlockCard job={job} laneId={laneId} compact={compact} className="h-full" />
        <span className="sr-only">, {details}</span>
        {saving ? (
          <Loader2 className="text-muted-foreground absolute top-1 right-2 size-3 animate-spin" aria-hidden />
        ) : null}
      </div>
      {resizable ? (
        <div
          ref={resize.setNodeRef}
          {...resize.attributes}
          {...resize.listeners}
          tabIndex={-1}
          aria-hidden
          title={t("block.resize", { number: job.number })}
          className="absolute top-0 right-0 h-full w-2 cursor-ew-resize rounded-r-md opacity-0 transition-opacity group-hover:bg-black/10 group-hover:opacity-100 dark:group-hover:bg-white/20"
        />
      ) : null}
    </div>
  );
}
