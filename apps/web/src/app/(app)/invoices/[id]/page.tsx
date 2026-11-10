import { balanceOf, dates, formatJobNumber, invoices } from "@fieldops/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LiveRefresh } from "@/components/app/live-refresh";
import { DocumentLines } from "@/components/billing/document-view";
import { billingFormData } from "@/components/billing/form-data";
import { dayText, money } from "@/components/billing/money";
import { InvoiceStatusBadge } from "@/components/billing/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { InvoiceActions } from "../_components/invoice-actions";
import { InvoiceForm } from "../_components/invoice-form";

export const metadata: Metadata = { title: "Invoice" };

/** An invoice (FIN-03, FIN-05): drafts are edited in place; issued invoices take payments. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const t = await getTranslations("billing");
  const tm = await getTranslations("billing.paymentMethod");
  const tz = actor.organization.timezone;
  const data = await runService(async (ctx) => {
    const invoice = await invoices.getInvoice(ctx, id);
    const [form, contacts] = await Promise.all([
      billingFormData(ctx, invoice.customerId),
      ctx.store.customers.contacts(invoice.customerId),
    ]);
    return { invoice, form, contacts, today: dates.localDateString(ctx.now, tz) };
  }, actor);
  const { invoice, form } = data;
  const jobNumber = invoice.job ? formatJobNumber(invoice.job.number) : null;
  const balance = invoice.status === "void" ? 0 : balanceOf(invoice);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <LiveRefresh kinds={["invoice"]} />
      <div>
        <Link
          href="/invoices"
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> {t("invoices.title")}
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span data-testid="invoice-status">
                <InvoiceStatusBadge status={invoice.status} label={t(`invoiceStatus.${invoice.status}`)} />
              </span>
              {jobNumber ? (
                <Link href={`/jobs/${jobNumber}`} className="text-muted-foreground font-mono hover:underline">
                  {jobNumber}
                </Link>
              ) : null}
              {invoice.quote ? (
                <Link
                  href={`/quotes/${invoice.quote.number}`}
                  className="text-muted-foreground font-mono hover:underline"
                >
                  {invoice.quote.number}
                </Link>
              ) : null}
            </div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight" data-testid="invoice-number">
              {invoice.number ?? t("invoice.draftTitle")}
            </h1>
            <p className="text-muted-foreground text-sm">
              <Link
                href={`/customers/${invoice.customer.id}`}
                className="hover:text-foreground font-medium underline-offset-2 hover:underline"
              >
                {invoice.customer.name}
              </Link>
              {invoice.job ? ` · ${invoice.job.title}` : ""}
            </p>
          </div>
          <InvoiceActions
            id={invoice.id}
            number={invoice.number}
            status={invoice.status}
            currency={invoice.currency}
            balanceMinor={balance}
            hasPayments={invoice.payments.length > 0}
            contactId={invoice.contactId}
            today={data.today}
            timeZone={tz}
            contacts={data.contacts
              .filter((c): c is typeof c & { email: string } => Boolean(c.email))
              .map((c) => ({ id: c.id, name: c.name, email: c.email }))}
          />
        </div>
      </div>

      {invoice.status === "draft" ? (
        <InvoiceForm
          invoice={{ id: invoice.id, version: invoice.version }}
          initial={{
            customer: invoice.customer,
            parties: form.parties,
            siteId: invoice.siteId,
            contactId: invoice.contactId,
            notes: invoice.notes,
            discountType: invoice.discountType,
            discountValue: invoice.discountValue,
            jobId: invoice.jobId,
            lines: invoice.lines.map((l) => ({
              kind: l.kind,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unit_price_minor: l.unitPriceMinor,
              tax_rate_bps: l.taxRateBps,
              catalog_item_id: l.catalogItemId,
              service_type_id: l.serviceTypeId,
              expense_request_id: l.expenseRequestId,
              unit_cost_minor: l.unitCostMinor,
              markup_bps: l.markupBps,
            })),
          }}
          currency={form.currency}
          taxRates={form.taxRates}
          services={form.services}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("lines.title")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DocumentLines
                  lines={invoice.lines}
                  currency={invoice.currency}
                  totals={invoice}
                  extra={[
                    { label: t("invoice.paid"), minor: invoice.amountPaidMinor },
                    { label: t("invoice.balance"), minor: balance, strong: true, testId: "balance" },
                  ]}
                />
                {invoice.notes ? <p className="text-sm whitespace-pre-line">{invoice.notes}</p> : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("invoice.payments")}{" "}
                  <span className="text-muted-foreground font-normal">({invoice.payments.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {invoice.payments.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("invoice.noPayments")}</p>
                ) : (
                  <ul className="divide-y" data-testid="payments">
                    {invoice.payments.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm"
                      >
                        <span>
                          <span className="font-medium tabular-nums">{money(p.amountMinor, p.currency)}</span>{" "}
                          <span className="text-muted-foreground">
                            · {tm(p.method)}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </span>
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(p.paidAt, tz)}
                          {p.recordedBy ? ` · ${p.recordedBy.name}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("invoice.details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Item label={t("form.billToContact")}>
                  {invoice.contact
                    ? `${invoice.contact.name}${invoice.contact.email ? ` · ${invoice.contact.email}` : ""}`
                    : "—"}
                </Item>
                <Item label={t("form.site")}>
                  {invoice.site ? `${invoice.site.label}, ${invoice.site.address.city}` : "—"}
                </Item>
                <Item label={t("columns.issued")}>{dayText(invoice.issueDate)}</Item>
                <Item label={t("columns.due")}>{dayText(invoice.dueDate)}</Item>
                <Item label={t("invoice.sentAt")}>{formatDateTime(invoice.sentAt, tz)}</Item>
                {invoice.paidAt ? (
                  <Item label={t("invoice.paidAt")}>{formatDateTime(invoice.paidAt, tz)}</Item>
                ) : null}
                {invoice.voidedAt ? (
                  <Item label={t("invoice.voidedAt")}>
                    {formatDateTime(invoice.voidedAt, tz)}
                    {invoice.voidReason ? ` · ${invoice.voidReason}` : ""}
                  </Item>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
