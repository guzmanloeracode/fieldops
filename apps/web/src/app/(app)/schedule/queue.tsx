"use client";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Inbox, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent } from "react";
import { PriorityBadge } from "@/components/app/badges";
import { SlaBadge } from "@/components/app/sla-badge";
import { cn } from "@/lib/utils";
import type { DragData } from "./board";
import type { BoardJob } from "./board-data";

/** The unscheduled queue (SCH-01): new jobs without a visit, urgent first. Also a drop zone to unschedule. */
export function QueuePanel(props: {
  jobs: BoardJob[];
  saving: Set<string>;
  activeId: string | null;
  acceptsDrop: boolean;
  onOpen: (job: BoardJob) => void;
}) {
  const t = useTranslations("dispatch.queue");
  const { setNodeRef, isOver } = useDroppable({ id: "queue-drop", data: { type: "queue" } });
  return (
    <aside
      ref={setNodeRef}
      aria-labelledby="queue-heading"
      className={cn(
        "bg-card w-full shrink-0 rounded-xl border lg:sticky lg:top-4 lg:w-80",
        props.acceptsDrop && "border-primary border-dashed",
        isOver && "ring-primary ring-2",
      )}
      data-testid="board-queue"
    >
      <div className="border-b px-4 py-3">
        <h2 id="queue-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Inbox className="size-4" aria-hidden /> {t("title")}
          <span className="bg-muted ml-auto rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
            {props.jobs.length}
          </span>
        </h2>
        <p className="text-muted-foreground text-xs">
          {props.acceptsDrop ? t("dropToUnschedule") : t("description")}
        </p>
      </div>
      {props.jobs.length === 0 ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-sm">{t("empty")}</p>
      ) : (
        <ul
          className="max-h-[70vh] space-y-2 overflow-y-auto p-3"
          aria-label={t("count", { count: props.jobs.length })}
        >
          {props.jobs.map((j) => (
            <QueueItem
              key={j.id}
              job={j}
              dimmed={props.activeId === j.id}
              saving={props.saving.has(j.id)}
              onOpen={props.onOpen}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

function QueueItem({
  job,
  dimmed,
  saving,
  onOpen,
}: {
  job: BoardJob;
  dimmed: boolean;
  saving: boolean;
  onOpen: (job: BoardJob) => void;
}) {
  const data: DragData = { type: "queue", jobId: job.id };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `queue:${job.id}`, data });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(e);
    if (e.defaultPrevented || isDragging) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(job);
    }
  };
  return (
    <li>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        onClick={() => onOpen(job)}
        data-testid="queue-item"
        data-job={job.number}
        className={cn(
          "hover:border-primary/50 focus-visible:ring-ring relative cursor-grab rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 active:cursor-grabbing",
          (dimmed || isDragging) && "opacity-40",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tabular-nums">{job.number}</span>
          <PriorityBadge priority={job.priority} className="ml-auto" />
          {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        </div>
        <p className="mt-1 truncate font-medium">{job.title}</p>
        <p className="text-muted-foreground truncate text-xs">
          {job.customer}
          {job.serviceType ? ` · ${job.serviceType}` : ""} · {job.durationMin} min
        </p>
        {job.sla ? <SlaBadge state={job.sla.state} prefixed className="mt-1.5" /> : null}
      </div>
    </li>
  );
}
