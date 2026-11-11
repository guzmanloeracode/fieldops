import { formatJobNumber, portalBilling } from "@fieldops/core";
import { ArrowLeft, CheckCircle2, Download, XCircle } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DocumentLines } from "@/components/billing/document-view";
import { dayText } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { getPortalOrg, runPortal } from "@/server/portal/session";
import { PortalQuoteStatus } from "../../billing-status";
import { QuoteDecision } from "./decision";
import { loadPortalQuote } from "./load";

/** A quote as the customer sees it (POR-04): lines and totals, validity, approve or decline, and the PDF. */
export default async function PortalQuotePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("pay.quotes");
  const locale = await getLocale();
  const q = await loadPortalQuote(slug, id);
  // The first time the customer opens it (the guard layout loads it before any skeleton; prefetches stop there).
  await runPortal(slug, (ctx) => portalBilling.markPortalQuoteViewed(ctx, id));
  const tz = org.timezone;
  const job = q.job ? formatJobNumber(q.job.number) : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/portal/${slug}/quotes`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("back")}
      </Link>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-sm" data-testid="portal-quote-number">
            {q.number}
          </span>
          <span data-testid="portal-quote-status">
            <PortalQuoteStatus status={q.status} />
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{q.title}</h1>
        <p className="text-muted-foreground text-sm">
          {q.sentAt ? t("sentOn", { date: formatDate(q.sentAt, tz, locale) }) : null}
          {q.validUntil && q.status !== "approved" && q.status !== "declined"
            ? ` · ${t("validUntil", { date: dayText(q.validUntil, locale) })}`
            : null}
        </p>
      </div>

      {q.status === "approved" ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          data-testid="portal-quote-outcome"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p>{t("approved", { date: formatDate(q.decidedAt, tz, locale) })}</p>
            {job ? (
              <p>
                {t("approvedJob", { org: org.name, job })}{" "}
                <Link href={`/portal/${slug}/jobs/${q.job!.number}`} className="font-medium underline">
                  {t("viewJob", { job })}
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      ) : q.status === "declined" ? (
        <div
          role="status"
          className="bg-muted flex items-start gap-2 rounded-lg p-3 text-sm"
          data-testid="portal-quote-outcome"
        >
          <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p>{t("declined", { date: formatDate(q.decidedAt, tz, locale) })}</p>
            {q.declineReason ? (
              <p className="whitespace-pre-line">{t("declinedReason", { reason: q.declineReason })}</p>
            ) : null}
          </div>
        </div>
      ) : q.status === "expired" ? (
        <p className="bg-muted rounded-lg p-3 text-sm" data-testid="portal-quote-outcome">
          {t("expired", { org: org.name })}
        </p>
      ) : null}

      {q.canDecide ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>{t("decideTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("decideHint", { org: org.name })}</CardDescription>
          </CardHeader>
          <CardContent>
            <QuoteDecision slug={slug} id={q.id} number={q.number} orgName={org.name} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            <h2>{t("lines")}</h2>
          </CardTitle>
          <Button asChild variant="outline" size="sm">
            <a href={`/portal/${slug}/quotes/${q.id}/pdf`} download data-testid="portal-quote-pdf">
              <Download aria-hidden /> {t("pdf")}
            </a>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <DocumentLines lines={q.lines} currency={q.currency} totals={q} />
          {q.site ? (
            <div>
              <h3 className="text-muted-foreground text-xs">{t("site")}</h3>
              <p className="text-sm">
                {q.site.label} · {q.site.line1}, {q.site.city}
              </p>
            </div>
          ) : null}
          {q.notes ? (
            <div>
              <h3 className="text-muted-foreground text-xs">{t("notes", { org: org.name })}</h3>
              <p className="text-sm whitespace-pre-line">{q.notes}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
