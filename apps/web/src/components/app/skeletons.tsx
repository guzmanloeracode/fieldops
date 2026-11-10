import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Loading states for the route-level loading.tsx files. Each skeleton follows the layout of the page it stands in
// for, so the content replaces it without the page jumping. Screen readers hear one "Loading…" status; the shapes
// are hidden from them.

const widths = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5"];
const width = (i: number) => widths[i % widths.length];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export async function LoadingPage({ children, className }: { children: ReactNode; className?: string }) {
  const t = await getTranslations("common");
  return (
    <div role="status" data-testid="page-skeleton">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className={cn("space-y-6", className)}>
        {children}
      </div>
    </div>
  );
}

/** The shape of <PageHeader>: title, description and an optional action button. */
export function HeaderSkeleton({
  action = false,
  description = true,
  eyebrow = false,
}: {
  action?: boolean;
  description?: boolean;
  eyebrow?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2">
        {eyebrow ? <Skeleton className="h-4 w-24" /> : null}
        <Skeleton className="h-8 w-56 max-w-full" />
        {description ? <Skeleton className="h-4 w-80 max-w-full" /> : null}
      </div>
      {action ? <Skeleton className="h-9 w-28 shrink-0" /> : null}
    </div>
  );
}

/** A row of filter controls; the first one is the wide search box when `search` is set. */
export function FiltersSkeleton({ count, search = false }: { count: number; search?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {search ? <Skeleton className="h-9 w-full sm:w-72" /> : null}
      {range(count).map((i) => (
        <Skeleton key={i} className="h-9 w-[calc(50%-0.25rem)] sm:w-36" />
      ))}
    </div>
  );
}

/** A bordered table: a header row and rows whose second column has a second line, like the job and customer lists. */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  const cols = range(columns);
  const hideOnPhones = (c: number) => (c >= 3 ? "hidden md:block" : "");
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="flex gap-6 border-b px-4 py-3">
        {cols.map((c) => (
          <div key={c} className={cn("flex-1", hideOnPhones(c))}>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      {range(rows).map((r) => (
        <div key={r} className="flex items-center gap-6 border-b px-4 py-3.5 last:border-b-0">
          {cols.map((c) => (
            <div key={c} className={cn("flex-1 space-y-1.5", hideOnPhones(c))}>
              <Skeleton className={cn("h-4", width(r + c))} />
              {c === 1 ? <Skeleton className={cn("h-3", width(r + c + 2))} /> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The shape of a <Card> with a title, an optional description and a body. */
export function CardSkeleton({
  className,
  description = false,
  lines = 3,
  children,
}: {
  className?: string;
  description?: boolean;
  lines?: number;
  children?: ReactNode;
}) {
  return (
    <div className={cn("bg-card flex flex-col gap-6 rounded-xl border py-6 shadow-sm", className)}>
      <div className="space-y-2 px-6">
        <Skeleton className="h-5 w-40" />
        {description ? <Skeleton className="h-4 w-64 max-w-full" /> : null}
      </div>
      <div className="space-y-3 px-6">
        {children ?? range(lines).map((i) => <Skeleton key={i} className={cn("h-4", width(i))} />)}
      </div>
    </div>
  );
}

/** Label and value pairs, as in the details cards. */
export function FieldsSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {range(count).map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className={cn("h-4", width(i))} />
        </div>
      ))}
    </div>
  );
}

/** Small stat tiles (KPIs, today's counts, customer totals). */
export function TilesSkeleton({
  count,
  className,
  tall = false,
}: {
  count: number;
  className?: string;
  tall?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", className)}>
      {range(count).map((i) => (
        <div key={i} className={cn("bg-card space-y-3 rounded-xl border p-4", tall && "space-y-4 p-5")}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className={cn("w-16", tall ? "h-8" : "h-7")} />
          {tall ? <Skeleton className="h-3 w-40 max-w-full" /> : null}
        </div>
      ))}
    </div>
  );
}

/** A list of items with a title, a meta line and a trailing control (approvals, today's lists). */
export function ListSkeleton({ rows = 5, action = false }: { rows?: number; action?: boolean }) {
  return (
    <div className="space-y-4">
      {range(rows).map((i) => (
        <div key={i} className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-4", width(i))} />
            <Skeleton className={cn("h-3", width(i + 2))} />
          </div>
          {action ? <Skeleton className="h-8 w-20 shrink-0" /> : <Skeleton className="h-4 w-12 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

/** A form in a card: labelled fields and, unless another card carries it, the submit button. */
export function FormSkeleton({ fields = 6, submit = true }: { fields?: number; submit?: boolean }) {
  return (
    <CardSkeleton description>
      <div className="grid gap-5 sm:grid-cols-2">
        {range(fields).map((i) => (
          <div key={i} className={cn("space-y-2", i === 0 && "sm:col-span-2")}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      {submit ? (
        <div className="flex justify-end pt-2">
          <Skeleton className="h-9 w-28" />
        </div>
      ) : null}
    </CardSkeleton>
  );
}

/** The dispatch board: toolbar, technician lanes on a timeline and the unscheduled queue. */
export function BoardSkeleton({ lanes = 8 }: { lanes?: number }) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-9 w-40" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-48" />
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="bg-card min-w-0 flex-1 overflow-hidden rounded-xl border">
          <div className="flex border-b">
            <div className="w-40 shrink-0 border-r px-3 py-2">
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex flex-1 justify-between px-3 py-2">
              {range(6).map((i) => (
                <Skeleton key={i} className={cn("h-3 w-8", i > 3 && "hidden sm:block")} />
              ))}
            </div>
          </div>
          {range(lanes).map((i) => (
            <div key={i} className="flex border-b last:border-b-0">
              <div className="w-40 shrink-0 space-y-1.5 border-r px-3 py-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="bg-muted/50 relative flex-1">
                <Skeleton
                  className="absolute inset-y-2"
                  style={{ left: `${8 + ((i * 23) % 40)}%`, width: `${18 + ((i * 11) % 22)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="bg-card w-full shrink-0 rounded-xl border lg:w-80">
          <div className="space-y-1.5 border-b px-4 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-44" />
          </div>
          <div className="space-y-3 p-3">
            {range(5).map((i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className={cn("h-4", width(i))} />
                <Skeleton className={cn("h-3", width(i + 1))} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
