import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Offset pagination for tables (ADR 010). `buildHref` keeps the other filters in the URL. */
export function Pagination({ page, pageSize, total, buildHref }: { page: number; pageSize: number; total: number; buildHref: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 py-3 text-sm">
      <p className="text-muted-foreground">
        {from}–{to} of {total.toLocaleString("en-US")}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground hidden sm:inline">
          Page {page} of {pages}
        </span>
        <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
          {page > 1 ? (
            <Link href={buildHref(page - 1)} aria-label="Previous page">
              <ChevronLeft /> Previous
            </Link>
          ) : (
            <span>
              <ChevronLeft /> Previous
            </span>
          )}
        </Button>
        <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>
          {page < pages ? (
            <Link href={buildHref(page + 1)} aria-label="Next page">
              Next <ChevronRight />
            </Link>
          ) : (
            <span>
              Next <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}
