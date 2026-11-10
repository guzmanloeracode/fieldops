import { balanceOf, can, invoices, quotes } from "@fieldops/core";
import { Plus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { dayText, money } from "@/components/billing/money";
import { InvoiceStatusBadge, QuoteStatusBadge } from "@/components/billing/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor, runService } from "@/server/context";

/** The customer page's quotes and invoices (FIN-02, FIN-03), for office roles. It loads its own data. */
export async function CustomerBilling({ customerId }: { customerId: string }) {
  const actor = await requireActor();
  if (!can(actor, "billing.manage")) return null;
  const t = await getTranslations("billing");
  const data = await runService(
    async (ctx) => ({
      quotes: await quotes.listQuotes(ctx, { customer: customerId, limit: 5 }),
      invoices: await invoices.listInvoices(ctx, { customer: customerId, limit: 5 }),
    }),
    actor,
  );
  const open = data.invoices.rows.filter((i) => i.status === "sent" || i.status === "overdue");
  return (
    <Card data-testid="customer-billing">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>{t("customer.title")}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/quotes/new?customer=${customerId}`}>
              <Plus /> {t("customer.newQuote")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/invoices/new?customer=${customerId}`}>
              <Plus /> {t("customer.newInvoice")}
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="customer-quotes" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="customer-quotes" className="text-sm font-medium">
              {t("quotes.title")}
            </h3>
            {data.quotes.rows.length ? (
              <Link href={`/quotes?customer=${customerId}`} className="text-primary text-xs hover:underline">
                {t("customer.viewAllQuotes")}
              </Link>
            ) : null}
          </div>
          {data.quotes.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("customer.noQuotes")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.quotes.rows.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                  <Link href={`/quotes/${q.number}`} className="font-mono text-xs hover:underline">
                    {q.number}
                  </Link>
                  <QuoteStatusBadge status={q.status} label={t(`quoteStatus.${q.status}`)} />
                  <span className="ml-auto tabular-nums">{money(q.totalMinor, q.currency)}</span>
                  <span className="text-muted-foreground w-full truncate text-xs">{q.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="customer-invoices" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="customer-invoices" className="text-sm font-medium">
              {t("invoices.title")}
            </h3>
            {data.invoices.rows.length ? (
              <Link
                href={`/invoices?customer=${customerId}`}
                className="text-primary text-xs hover:underline"
              >
                {t("customer.viewAllInvoices")}
              </Link>
            ) : null}
          </div>
          {open.length ? (
            <p className="text-muted-foreground text-xs">
              {t("customer.openBalance", {
                amount: money(
                  open.reduce((a, i) => a + balanceOf(i), 0),
                  open[0]!.currency,
                ),
              })}
            </p>
          ) : null}
          {data.invoices.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("customer.noInvoices")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.invoices.rows.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                  <Link href={`/invoices/${i.id}`} className="font-mono text-xs hover:underline">
                    {i.number ?? t("invoice.draftNumber")}
                  </Link>
                  <InvoiceStatusBadge status={i.status} label={t(`invoiceStatus.${i.status}`)} />
                  <span className="ml-auto tabular-nums">{money(i.totalMinor, i.currency)}</span>
                  <span className="text-muted-foreground w-full text-xs">
                    {i.dueDate ? t("customer.due", { date: dayText(i.dueDate) }) : t("invoice.draftTitle")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
