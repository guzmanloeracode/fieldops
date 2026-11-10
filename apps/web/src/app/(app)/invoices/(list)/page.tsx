import { balanceOf, formatJobNumber, invoices } from "@fieldops/core";
import { INVOICE_STATUSES, invoiceListQuerySchema } from "@fieldops/shared";
import { Plus, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LiveRefresh } from "@/components/app/live-refresh";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { ListFilters } from "@/components/billing/list-filters";
import { dayText, money } from "@/components/billing/money";
import { InvoiceStatusBadge } from "@/components/billing/status-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActor, runService } from "@/server/context";

export const metadata: Metadata = { title: "Invoices" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f-]{36}$/i;

/** Invoices (FIN-03) with what's outstanding and overdue now. Office roles (layout). */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const t = await getTranslations("billing");
  const sp = await searchParams;
  const parsed = invoiceListQuerySchema.safeParse({
    q: one(sp.q) || undefined,
    status: one(sp.status) || undefined,
    customer: one(sp.customer) || undefined,
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
    limit: 25,
    page: one(sp.page) || 1,
  });
  const query = parsed.success ? parsed.data : invoiceListQuerySchema.parse({ limit: 25, page: 1 });
  const data = await runService(
    async (ctx) => ({
      page: await invoices.listInvoices(ctx, query),
      summary: await invoices.receivablesNow(ctx),
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
    return `/invoices?${p.toString()}`;
  };
  const filtered = Boolean(query.q || query.status || query.customer || query.from || query.to);
  const rows = data.page.rows;
  const s = data.summary;

  return (
    <div>
      <LiveRefresh kinds={["invoice"]} />
      <PageHeader
        title={t("invoices.title")}
        description={
          data.customer ? t("invoices.forCustomer", { name: data.customer.name }) : t("invoices.description")
        }
        actions={
          <Button asChild>
            <Link href={data.customer ? `/invoices/new?customer=${data.customer.id}` : "/invoices/new"}>
              <Plus /> {t("invoices.new")}
            </Link>
          </Button>
        }
      />
      <ul className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="receivables">
        <li className="bg-card rounded-xl border p-4">
          <div>
            <span className="text-muted-foreground text-xs font-medium">{t("invoices.outstanding")}</span>
            <span className="block text-2xl font-semibold tabular-nums">
              {money(s.outstandingMinor, s.currency)}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("invoices.openCount", { count: s.outstandingCount })}
            </span>
          </div>
        </li>
        <li className="bg-card rounded-xl border p-4">
          <Link href="/invoices?status=overdue" className="block">
            <span className="text-muted-foreground text-xs font-medium">{t("invoices.overdue")}</span>
            <span className="block text-2xl font-semibold tabular-nums text-amber-800 dark:text-amber-300">
              {money(s.overdueMinor, s.currency)}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("invoices.openCount", { count: s.overdueCount })}
            </span>
          </Link>
        </li>
      </ul>
      <ListFilters
        statuses={INVOICE_STATUSES.map((st) => ({ value: st, label: t(`invoiceStatus.${st}`) }))}
        customer={data.customer ? { id: data.customer.id, name: data.customer.name } : null}
        dates={{ label: t("filters.issued") }}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title={filtered ? t("invoices.emptyFiltered") : t("invoices.empty")}
          description={filtered ? undefined : t("invoices.emptyHint")}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <caption className="sr-only">{t("invoices.title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.number")}</TableHead>
                  <TableHead scope="col">{t("columns.customer")}</TableHead>
                  <TableHead scope="col">{t("columns.job")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                  <TableHead scope="col">{t("columns.issued")}</TableHead>
                  <TableHead scope="col">{t("columns.due")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("columns.total")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("columns.balance")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => (
                  <TableRow key={i.id} data-testid="invoice-row">
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      <Link href={`/invoices/${i.id}`} className="hover:underline">
                        {i.number ?? t("invoice.draftNumber")}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{i.customer.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {i.job ? formatJobNumber(i.job.number) : "—"}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={i.status} label={t(`invoiceStatus.${i.status}`)} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{dayText(i.issueDate)}</TableCell>
                    <TableCell className="whitespace-nowrap">{dayText(i.dueDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(i.totalMinor, i.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {i.status === "void" || i.status === "draft" ? "—" : money(balanceOf(i), i.currency)}
                    </TableCell>
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
