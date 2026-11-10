import type { ExpenseStatus } from "@fieldops/shared";
import { cn } from "@/lib/utils";

const STYLES: Record<ExpenseStatus, string> = {
  pending:
    "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  approved:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  rejected: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
};

/** Request status as a pill. `label` comes from the caller's translations. */
export function ExpenseStatusBadge({ status, label }: { status: ExpenseStatus; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        STYLES[status],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
