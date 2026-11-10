import type { InvoiceStatus, QuoteStatus } from "@fieldops/shared";
import { cn } from "@/lib/utils";

// Status badges for quotes and invoices (FIN-02, FIN-03). The label comes from the `billing` messages; color is
// never the only signal.

const base =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset";
const tone = {
  slate:
    "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  sky: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  emerald:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  red: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
  amber:
    "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  zinc: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700",
};

const QUOTE: Record<QuoteStatus, string> = {
  draft: tone.slate,
  sent: tone.sky,
  approved: tone.emerald,
  declined: tone.red,
  expired: tone.zinc,
};

const INVOICE: Record<InvoiceStatus, string> = {
  draft: tone.slate,
  sent: tone.sky,
  paid: tone.emerald,
  overdue: tone.amber,
  void: `${tone.zinc} line-through`,
};

export function QuoteStatusBadge({ status, label }: { status: QuoteStatus; label: string }) {
  return (
    <span className={cn(base, QUOTE[status])} data-status={status}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function InvoiceStatusBadge({ status, label }: { status: InvoiceStatus; label: string }) {
  return (
    <span className={cn(base, INVOICE[status])} data-status={status}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
