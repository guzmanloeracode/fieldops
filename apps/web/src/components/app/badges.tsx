import { PRIORITY_LABELS, STATUS_LABELS } from "@fieldops/core";
import type { JobPriority, JobStatus } from "@fieldops/shared";
import { ArrowDown, ArrowUp, ChevronsUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<JobStatus, string> = {
  new: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  scheduled: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  en_route: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-800",
  in_progress: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  on_hold: "bg-orange-50 text-orange-900 ring-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  canceled: "bg-zinc-100 text-zinc-500 ring-zinc-200 line-through dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700",
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        STATUS_STYLES[status],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_ICON = { low: ArrowDown, normal: Minus, high: ArrowUp, urgent: ChevronsUp } as const;
const PRIORITY_STYLE: Record<JobPriority, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground/80",
  high: "text-orange-600 dark:text-orange-400",
  urgent: "text-red-600 dark:text-red-400 font-semibold",
};

export function PriorityBadge({ priority, className }: { priority: JobPriority; className?: string }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap", PRIORITY_STYLE[priority], className)}>
      <Icon aria-hidden className="size-3.5" />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
