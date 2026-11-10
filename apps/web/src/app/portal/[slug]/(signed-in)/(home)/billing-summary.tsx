import { portalBilling } from "@fieldops/core";
import { ChevronRight, FileText, Receipt } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { dayText, money } from "@/components/billing/money";
import { runPortal } from "@/server/portal/session";
import { PortalInvoiceStatus, PortalQuoteStatus } from "../billing-status";

/** "Waiting for you" on the portal home (POR-04): quotes to decide and invoices to pay. Nothing when all is done. */
export async function PortalBillingSummary({ slug }: { slug: string }) {
  const { quotes, invoices } = await runPortal(slug, (ctx) => portalBilling.portalBillingSummary(ctx));
  if (!quotes.length && !invoices.length) return null;
  const t = await getTranslations("pay.home");
  const row =
    "bg-card hover:bg-accent/50 focus-visible:ring-ring flex items-center gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none";
  return (
    <section aria-labelledby="waiting" className="space-y-3" data-testid="portal-billing-summary">
      <h2 id="waiting" className="text-base font-semibold">
        {t("title")}
      </h2>
      <ul className="space-y-3">
        {quotes.map((q) => (
          <li key={q.id}>
            <Link href={`/portal/${slug}/quotes/${q.id}`} className={row} data-testid="portal-quote-todo">
              <FileText aria-hidden className="text-muted-foreground size-5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t("quote", { number: q.number })}</span>
                  <PortalQuoteStatus status={q.status} />
                </div>
                <p className="truncate text-sm">{q.title}</p>
                <p className="text-muted-foreground text-sm">
                  {t("quoteMeta", { total: money(q.totalMinor, q.currency), date: dayText(q.validUntil) })}
                </p>
              </div>
              <span className="text-primary shrink-0 text-sm font-medium">{t("review")}</span>
              <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
            </Link>
          </li>
        ))}
        {invoices.map((i) => (
          <li key={i.id}>
            <Link href={`/portal/${slug}/invoices/${i.id}`} className={row} data-testid="portal-invoice-todo">
              <Receipt aria-hidden className="text-muted-foreground size-5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t("invoice", { number: i.number })}</span>
                  <PortalInvoiceStatus status={i.status} />
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("invoiceMeta", { balance: money(i.balanceMinor, i.currency), date: dayText(i.dueDate) })}
                </p>
              </div>
              <span className="text-primary shrink-0 text-sm font-medium">{t("pay")}</span>
              <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
