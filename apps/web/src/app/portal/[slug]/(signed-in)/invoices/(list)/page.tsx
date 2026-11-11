import { portalBilling } from "@fieldops/core";
import { ChevronRight, Receipt } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { dayText, money } from "@/components/billing/money";
import { EmptyState } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { getPortalOrg, runPortal } from "@/server/portal/session";
import { PortalInvoiceStatus } from "../../billing-status";

/** The customer's invoices (POR-04), newest first, with what is left to pay. */
export default async function PortalInvoicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("pay.invoices");
  const locale = await getLocale();
  const invoices = await runPortal(slug, (ctx) => portalBilling.listPortalInvoices(ctx));
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description", { org: org.name })}</p>
      </div>
      {invoices.length ? (
        <ul className="space-y-3">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link
                href={`/portal/${slug}/invoices/${i.id}`}
                className="bg-card hover:bg-accent/50 focus-visible:ring-ring flex items-start gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                data-testid="portal-invoice"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{i.number}</span>
                    <PortalInvoiceStatus status={i.status} />
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {i.status === "paid"
                      ? t("paidOn", { date: formatDate(i.paidAt, org.timezone, locale) })
                      : `${t("issuedOn", { date: dayText(i.issueDate, locale) })} · ${t("dueOn", { date: dayText(i.dueDate, locale) })}`}
                  </p>
                  {i.balanceMinor > 0 ? (
                    <p className="text-sm">
                      {t("balance")}:{" "}
                      <span className="font-medium tabular-nums">
                        {money(i.balanceMinor, i.currency, locale)}
                      </span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {money(i.totalMinor, i.currency, locale)}
                    </p>
                  )}
                </div>
                <ChevronRight aria-hidden className="text-muted-foreground mt-1 size-4 shrink-0" />
                <span className="sr-only">{t("open", { number: i.number })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Receipt />} title={t("empty")} description={t("emptyHint", { org: org.name })} />
      )}
    </div>
  );
}
