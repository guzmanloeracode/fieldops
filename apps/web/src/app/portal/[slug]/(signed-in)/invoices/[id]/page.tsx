import { formatJobNumber, portalBilling } from "@fieldops/core";
import { ArrowLeft, CheckCircle2, Download, Info } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DocumentLines } from "@/components/billing/document-view";
import { dayText, money } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { onlinePayments } from "@/server/payments";
import { getPortalOrg, runPortal } from "@/server/portal/session";
import { PortalInvoiceStatus } from "../../billing-status";
import { loadPortalInvoice } from "./load";
import { PayButton } from "./pay-button";

/**
 * An invoice as the customer sees it (POR-04, FIN-05): what is left to pay, "Pay now" when online payments are on
 * (else the bank transfer instructions), lines and totals, payments so far, and the PDF.
 */
export default async function PortalInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { slug, id } = await params;
  const { payment } = await searchParams;
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("pay.invoices");
  const tm = await getTranslations("billing.paymentMethod");
  const tl = await getTranslations("billing.invoice");
  const inv = await loadPortalInvoice(slug, id);
  await runPortal(slug, (ctx) => portalBilling.markPortalInvoiceViewed(ctx, id));
  const tz = org.timezone;
  const mode = onlinePayments();
  const online = mode !== "unavailable";

  const banner =
    payment === "success"
      ? inv.status === "paid"
        ? { tone: "ok", text: t("success") }
        : { tone: "info", text: t("pending") }
      : payment === "canceled" && inv.canPay
        ? { tone: "info", text: t("canceled") }
        : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/portal/${slug}/invoices`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("back")}
      </Link>
      {banner ? (
        <p
          role="status"
          className={
            banner.tone === "ok"
              ? "flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-muted flex items-start gap-2 rounded-lg p-3 text-sm"
          }
          data-testid="portal-payment-banner"
        >
          {banner.tone === "ok" ? (
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          {banner.text}
        </p>
      ) : null}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="portal-invoice-status">
            <PortalInvoiceStatus status={inv.status} />
          </span>
          {inv.job ? (
            <Link
              href={`/portal/${slug}/jobs/${inv.job.number}`}
              className="text-muted-foreground font-mono text-sm hover:underline"
            >
              {formatJobNumber(inv.job.number)}
            </Link>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="portal-invoice-number">
          {t("heading", { number: inv.number })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("issuedOn", { date: dayText(inv.issueDate) })} · {t("dueOn", { date: dayText(inv.dueDate) })}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          {inv.status === "void" ? (
            <p className="text-sm">{t("void")}</p>
          ) : inv.status === "paid" ? (
            <p className="flex items-center gap-2 text-sm font-medium" data-testid="portal-invoice-paid">
              <CheckCircle2 aria-hidden className="size-4 text-emerald-700 dark:text-emerald-400" />
              {t("paidInFull", { date: formatDate(inv.paidAt, tz) })}
            </p>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-muted-foreground text-sm">{t("balance")}</p>
                <p className="text-3xl font-semibold tabular-nums" data-testid="portal-invoice-balance">
                  {money(inv.balanceMinor, inv.currency)}
                </p>
                <p className="text-muted-foreground text-sm">{t("dueOn", { date: dayText(inv.dueDate) })}</p>
              </div>
              {inv.canPay && online ? (
                <div className="space-y-1.5 sm:text-right">
                  <PayButton slug={slug} id={inv.id} />
                  {mode === "simulated" ? (
                    <p className="text-muted-foreground text-xs">{t("testMode")}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          {inv.canPay ? (
            inv.paymentInstructions ? (
              <div className="border-t pt-4" data-testid="portal-payment-instructions">
                <h2 className="text-sm font-medium">{t("otherWays")}</h2>
                {online ? null : (
                  <p className="text-muted-foreground mt-1 text-sm">{t("noOnline", { org: org.name })}</p>
                )}
                <p className="mt-2 text-sm whitespace-pre-line">{inv.paymentInstructions}</p>
              </div>
            ) : online ? null : (
              <p className="text-muted-foreground text-sm">{t("contact", { org: org.name })}</p>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            <h2>{t("lines")}</h2>
          </CardTitle>
          <Button asChild variant="outline" size="sm">
            <a href={`/portal/${slug}/invoices/${inv.id}/pdf`} download data-testid="portal-invoice-pdf">
              <Download aria-hidden /> {t("pdf")}
            </a>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <DocumentLines
            lines={inv.lines}
            currency={inv.currency}
            totals={inv}
            extra={[
              { label: tl("paid"), minor: inv.amountPaidMinor },
              { label: tl("balance"), minor: inv.balanceMinor, strong: true, testId: "balance" },
            ]}
          />
          {inv.notes ? <p className="text-sm whitespace-pre-line">{inv.notes}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>{t("payments")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inv.payments.length ? (
            <ul className="divide-y" data-testid="portal-payments">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <span className="font-medium tabular-nums">{money(p.amountMinor, inv.currency)}</span>{" "}
                    <span className="text-muted-foreground">· {tm(p.method)}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">{formatDate(p.paidAt, tz)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noPayments")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
