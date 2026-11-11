import { balanceOf, can, invoices, quotes } from "@fieldops/core";
import type { JobStatus } from "@fieldops/shared";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { money } from "@/components/billing/money";
import { InvoiceStatusBadge, QuoteStatusBadge } from "@/components/billing/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor, runService } from "@/server/context";

/**
 * The job page's "Billing" section for office roles: the quote the job came from and the job's invoices (JOB-05),
 * with "Create invoice" once the job is completed (FIN-03). It loads its own data.
 */
export async function JobBilling({
  jobId,
  jobNumber,
  status,
}: {
  jobId: string;
  jobNumber: string;
  status: JobStatus;
}) {
  const actor = await requireActor();
  if (!can(actor, "billing.manage")) return null;
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const data = await runService(
    async (ctx) => ({
      quote: await quotes.quoteForJob(ctx, jobId),
      invoices: await invoices.invoicesForJob(ctx, jobId),
    }),
    actor,
  );
  const live = data.invoices.filter((i) => i.status !== "void");
  return (
    <Card data-testid="job-billing">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("job.title")}</CardTitle>
        {status === "completed" ? (
          <Button asChild size="sm" variant={live.length ? "outline" : "default"}>
            <Link href={`/invoices/new?job=${jobNumber}`} data-testid="create-invoice">
              <FilePlus2 /> {t("job.createInvoice")}
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {data.quote ? (
          <p className="flex flex-wrap items-center gap-2" data-testid="job-quote">
            <span className="text-muted-foreground">{t("job.fromQuote")}</span>
            <Link href={`/quotes/${data.quote.number}`} className="text-primary font-mono hover:underline">
              {data.quote.number}
            </Link>
            <QuoteStatusBadge status={data.quote.status} label={t(`quoteStatus.${data.quote.status}`)} />
            <span className="tabular-nums">{money(data.quote.totalMinor, data.quote.currency, locale)}</span>
          </p>
        ) : null}
        {data.invoices.length === 0 ? (
          <p className="text-muted-foreground">
            {status === "completed" ? t("job.noInvoicesYet") : t("job.invoiceWhenCompleted")}
          </p>
        ) : (
          <ul className="divide-y" aria-label={t("job.invoices")}>
            {data.invoices.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <Link href={`/invoices/${i.id}`} className="font-mono text-xs hover:underline">
                  {i.number ?? t("invoice.draftNumber")}
                </Link>
                <InvoiceStatusBadge status={i.status} label={t(`invoiceStatus.${i.status}`)} />
                <span className="ml-auto tabular-nums">{money(i.totalMinor, i.currency, locale)}</span>
                {i.status === "sent" || i.status === "overdue" ? (
                  <span className="text-muted-foreground w-full text-xs sm:w-auto">
                    {t("job.balance", { amount: money(balanceOf(i), i.currency, locale) })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
