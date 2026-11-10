"use client";
import type { JobPriority, JobStatus } from "@fieldops/shared";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Inbox } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { SlaBadge } from "@/components/app/sla-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatWindow } from "@/lib/format";
import { BulkBar } from "./bulk-bar";

export interface JobRow {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  customer: string;
  city: string;
  site: string;
  serviceType: string | null;
  assignees: string[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  createdAt: string;
  needsReview: boolean;
  /** The current SLA when it needs attention (at risk or breached), with a tooltip; null otherwise. */
  sla?: { state: "at_risk" | "breached"; title: string } | null;
}

const SORTABLE: Record<string, string> = {
  number: "number",
  title: "title",
  status: "status",
  priority: "priority",
  scheduled: "scheduled_start",
  createdAt: "created_at",
};
const STORAGE_KEY = "fieldops.jobs.columns";

/** Office-only bulk tools (JOB-04): row selection, bulk actions and CSV export. */
export interface BulkOptions {
  members: { id: string; name: string }[];
  /** Export of every job matching the current filters. */
  exportHref: string;
}

export function JobsTable({
  rows,
  sort,
  timeZone,
  sortable,
  bulk,
}: {
  rows: JobRow[];
  sort: string;
  timeZone: string;
  sortable: boolean;
  bulk?: BulkOptions;
}) {
  const t = useTranslations("jobs");
  const locale = useLocale();
  const tb = useTranslations("insights.bulk");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const rowKey = rows.map((r) => r.id).join(",");
  // A new page or new filters start with nothing selected.
  useEffect(() => setRowSelection({}), [rowKey]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visibility, setVisibility] = useState<VisibilityState>({ createdAt: false, serviceType: true });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setVisibility(JSON.parse(saved) as VisibilityState);
    } catch {
      // storage unavailable: keep defaults
    }
  }, []);

  const setSort = (field: string) => {
    // First click sorts ascending, the next click descending.
    const current = sort.split(",")[0] ?? "";
    const next = current === field ? `-${field}` : field;
    const p = new URLSearchParams(searchParams.toString());
    p.set("sort", next);
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  };

  const columns = useMemo<ColumnDef<JobRow>[]>(
    () => [
      ...(bulk
        ? [
            {
              id: "select",
              header: ({ table }) => (
                <Checkbox
                  aria-label={tb("selectAll")}
                  data-testid="select-all"
                  checked={
                    table.getIsAllPageRowsSelected()
                      ? true
                      : table.getIsSomePageRowsSelected()
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  aria-label={tb("selectRow", { number: row.original.number })}
                  data-testid="select-row"
                  checked={row.getIsSelected()}
                  onCheckedChange={(v) => row.toggleSelected(v === true)}
                />
              ),
              enableHiding: false,
            } satisfies ColumnDef<JobRow>,
          ]
        : []),
      {
        id: "number",
        header: t("col.number"),
        cell: ({ row }) => (
          <Link
            href={`/jobs/${row.original.number}`}
            className="text-primary font-mono text-xs font-medium hover:underline"
          >
            {row.original.number}
          </Link>
        ),
        enableHiding: false,
      },
      {
        id: "title",
        header: t("col.job"),
        cell: ({ row }) => (
          <div className="min-w-56">
            <Link href={`/jobs/${row.original.number}`} className="font-medium hover:underline">
              {row.original.title}
            </Link>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span className="truncate">
                {row.original.customer} · {row.original.city}
              </span>
              {row.original.needsReview ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <Inbox className="size-3" aria-hidden /> {t("needsReview")}
                </span>
              ) : null}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "status",
        header: t("col.status"),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "priority",
        header: t("col.priority"),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <PriorityBadge priority={row.original.priority} />
            {row.original.sla ? (
              <SlaBadge state={row.original.sla.state} prefixed title={row.original.sla.title} />
            ) : null}
          </span>
        ),
      },
      {
        id: "scheduled",
        header: t("col.scheduled"),
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">
            {row.original.scheduledStart ? (
              formatWindow(row.original.scheduledStart, row.original.scheduledEnd, timeZone, locale)
            ) : (
              <span className="text-muted-foreground">{t("unscheduled")}</span>
            )}
          </span>
        ),
      },
      {
        id: "assignees",
        header: t("col.technician"),
        cell: ({ row }) =>
          row.original.assignees.length ? (
            <span className="text-sm whitespace-nowrap">
              {row.original.assignees[0]}
              {row.original.assignees.length > 1 ? (
                <span className="text-muted-foreground"> +{row.original.assignees.length - 1}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "serviceType",
        header: t("col.serviceType"),
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">{row.original.serviceType ?? "—"}</span>
        ),
      },
      {
        id: "createdAt",
        header: t("col.created"),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm whitespace-nowrap">
            {formatDate(row.original.createdAt, timeZone, locale)}
          </span>
        ),
      },
    ],
    [t, tb, timeZone, bulk],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    enableRowSelection: Boolean(bulk),
    onRowSelectionChange: setRowSelection,
    state: { columnVisibility: visibility, rowSelection },
    onColumnVisibilityChange: (updater) => {
      setVisibility((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    manualSorting: true,
    manualPagination: true,
  });

  const sortIcon = (field: string) => {
    const current = sort.split(",")[0];
    if (current === field) return <ArrowUp className="size-3.5" aria-hidden />;
    if (current === `-${field}`) return <ArrowDown className="size-3.5" aria-hidden />;
    return <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />;
  };
  const ariaSort = (field: string): "ascending" | "descending" | "none" => {
    const current = sort.split(",")[0];
    return current === field ? "ascending" : current === `-${field}` ? "descending" : "none";
  };

  const selected = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  return (
    <div className="space-y-2">
      {bulk ? <BulkBar ids={selected} members={bulk.members} onClear={() => setRowSelection({})} /> : null}
      <div className="flex justify-end gap-1">
        {bulk ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={bulk.exportHref} download title={tb("exportAllHint")} data-testid="export-all">
              <Download /> {tb("exportAll")}
            </a>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Columns3 /> {t("columns")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("showColumns")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={c.getIsVisible()}
                  onCheckedChange={(v) => c.toggleVisibility(Boolean(v))}
                >
                  {String(c.columnDef.header)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="bg-card overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const field = SORTABLE[h.column.id];
                  return (
                    <TableHead
                      key={h.id}
                      aria-sort={sortable && field ? ariaSort(field) : undefined}
                      className="whitespace-nowrap"
                    >
                      {sortable && field ? (
                        <button
                          type="button"
                          onClick={() => setSort(field)}
                          className="hover:text-foreground inline-flex items-center gap-1"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sortIcon(field)}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid="job-row"
                data-state={row.getIsSelected() ? "selected" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
