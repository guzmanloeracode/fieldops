import { portalBilling } from "@fieldops/core";
import { ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { dayText, money } from "@/components/billing/money";
import { EmptyState } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { getPortalOrg, runPortal } from "@/server/portal/session";
import { PortalQuoteStatus } from "../../billing-status";

/** The customer's quotes (POR-04), newest first. */
export default async function PortalQuotesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("pay.quotes");
  const quotes = await runPortal(slug, (ctx) => portalBilling.listPortalQuotes(ctx));
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description", { org: org.name })}</p>
      </div>
      {quotes.length ? (
        <ul className="space-y-3">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link
                href={`/portal/${slug}/quotes/${q.id}`}
                className="bg-card hover:bg-accent/50 focus-visible:ring-ring flex items-start gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                data-testid="portal-quote"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground font-mono text-xs">{q.number}</span>
                    <PortalQuoteStatus status={q.status} />
                  </div>
                  <p className="font-medium">{q.title}</p>
                  <p className="text-muted-foreground text-sm">
                    <span className="text-foreground font-medium tabular-nums">
                      {money(q.totalMinor, q.currency)}
                    </span>
                    {" · "}
                    {q.decidedAt
                      ? t("decidedOn", { date: formatDate(q.decidedAt, org.timezone) })
                      : t("validUntil", { date: dayText(q.validUntil) })}
                  </p>
                </div>
                <ChevronRight aria-hidden className="text-muted-foreground mt-1 size-4 shrink-0" />
                <span className="sr-only">{t("open", { number: q.number })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<FileText />} title={t("empty")} description={t("emptyHint", { org: org.name })} />
      )}
    </div>
  );
}
