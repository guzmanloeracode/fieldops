import { quotes } from "@fieldops/core";
import { QUOTE_STATUSES, quoteListQuerySchema } from "@fieldops/shared";
import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LiveRefresh } from "@/components/app/live-refresh";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { ListFilters } from "@/components/billing/list-filters";
import { dayText, money } from "@/components/billing/money";
import { QuoteStatusBadge } from "@/components/billing/status-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { requireActor, runService } from "@/server/context";

export const metadata: Metadata = { title: "Quotes" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f-]{36}$/i;

/** Quotes (FIN-02): status, customer, search and date filters in the URL, paginated. Office roles (layout). */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const t = await getTranslations("billing");
  const sp = await searchParams;
  const tz = actor.organization.timezone;
  const parsed = quoteListQuerySchema.safeParse({
    q: one(sp.q) || undefined,
    status: one(sp.status) || undefined,
    customer: one(sp.customer) || undefined,
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
    limit: 25,
    page: one(sp.page) || 1,
  });
  const query = parsed.success ? parsed.data : quoteListQuerySchema.parse({ limit: 25, page: 1 });
  const data = await runService(
    async (ctx) => ({
      page: await quotes.listQuotes(ctx, query),
      customer:
        query.customer && UUID.test(query.customer) ? await ctx.store.customers.get(query.customer) : null,
    }),
    actor,
  );
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v);
    if (val && k !== "page") params.set(k, val);
  }
  const buildHref = (page: number) => {
    const p = new URLSearchParams(params);
    p.set("page", String(page));
    return `/quotes?${p.toString()}`;
  };
  const filtered = Boolean(query.q || query.status || query.customer || query.from || query.to);
  const rows = data.page.rows;

  return (
    <div>
      <LiveRefresh kinds={["quote"]} />
      <PageHeader
        title={t("quotes.title")}
        description={
          data.customer ? t("quotes.forCustomer", { name: data.customer.name }) : t("quotes.description")
        }
        actions={
          <Button asChild>
            <Link href={data.customer ? `/quotes/new?customer=${data.customer.id}` : "/quotes/new"}>
              <Plus /> {t("quotes.new")}
            </Link>
          </Button>
        }
      />
      <ListFilters
        statuses={QUOTE_STATUSES.map((s) => ({ value: s, label: t(`quoteStatus.${s}`) }))}
        customer={data.customer ? { id: data.customer.id, name: data.customer.name } : null}
        dates={{ label: t("filters.created") }}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={filtered ? t("quotes.emptyFiltered") : t("quotes.empty")}
          description={filtered ? undefined : t("quotes.emptyHint")}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <caption className="sr-only">{t("quotes.title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.number")}</TableHead>
                  <TableHead scope="col">{t("columns.customer")}</TableHead>
                  <TableHead scope="col">{t("columns.title")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("columns.total")}
                  </TableHead>
                  <TableHead scope="col">{t("columns.validUntil")}</TableHead>
                  <TableHead scope="col">{t("columns.created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((q) => (
                  <TableRow key={q.id} data-testid="quote-row">
                    <TableCell className="font-mono text-xs">
                      <Link href={`/quotes/${q.number}`} className="hover:underline">
                        {q.number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{q.customer.name}</TableCell>
                    <TableCell className="max-w-64 truncate">
                      <Link href={`/quotes/${q.number}`} className="hover:underline">
                        {q.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} label={t(`quoteStatus.${q.status}`)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(q.totalMinor, q.currency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{dayText(q.validUntil)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(q.createdAt, tz)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={query.page ?? 1}
            pageSize={query.limit}
            total={data.page.total ?? rows.length}
            buildHref={buildHref}
          />
        </>
      )}
    </div>
  );
}
