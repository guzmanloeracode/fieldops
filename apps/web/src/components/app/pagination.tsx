import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

/** Offset pagination for tables (ADR 010). `buildHref` keeps the other filters in the URL. */
export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const t = useTranslations("common.pagination");
  const locale = useLocale();
  return (
    <nav aria-label={t("label")} className="flex items-center justify-between gap-4 py-3 text-sm">
      <p className="text-muted-foreground">{t("range", { from, to, total: formatNumber(total, locale) })}</p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground hidden sm:inline">{t("page", { page, pages })}</span>
        <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
          {page > 1 ? (
            <Link href={buildHref(page - 1)} aria-label={t("previousPage")}>
              <ChevronLeft /> <span className="max-sm:sr-only">{t("previous")}</span>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <ChevronLeft /> <span className="max-sm:sr-only">{t("previous")}</span>
            </span>
          )}
        </Button>
        <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>
          {page < pages ? (
            <Link href={buildHref(page + 1)} aria-label={t("nextPage")}>
              <span className="max-sm:sr-only">{t("next")}</span> <ChevronRight />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="max-sm:sr-only">{t("next")}</span> <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}
