import { formatJobNumber, quotes } from "@fieldops/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LiveRefresh } from "@/components/app/live-refresh";
import { DocumentLines } from "@/components/billing/document-view";
import { billingFormData } from "@/components/billing/form-data";
import { dayText } from "@/components/billing/money";
import { QuoteStatusBadge } from "@/components/billing/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { QuoteActions } from "../_components/quote-actions";
import { QuoteForm } from "../_components/quote-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}): Promise<Metadata> {
  const { number } = await params;
  return { title: decodeURIComponent(number).toUpperCase() };
}

/** A quote (FIN-02): drafts are edited in place; sent quotes wait for the customer's decision. */
export default async function QuotePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const actor = await requireActor();
  const t = await getTranslations("billing");
  const tp = await getTranslations("pay.staff");
  const locale = await getLocale();
  const tz = actor.organization.timezone;
  const data = await runService(async (ctx) => {
    const quote = await quotes.getQuote(ctx, decodeURIComponent(number));
    const [form, contacts] = await Promise.all([
      billingFormData(ctx, quote.customerId),
      ctx.store.customers.contacts(quote.customerId),
    ]);
    return { quote, form, contacts };
  }, actor);
  const { quote, form } = data;
  const jobNumber = quote.job ? formatJobNumber(quote.job.number) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <LiveRefresh kinds={["quote"]} />
      <div>
        <Link
          href="/quotes"
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> {t("quotes.title")}
        </Link>
        {/* The title keeps at least 28rem; when the actions don't fit beside it they wrap below. */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-[1_1_28rem] space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground font-mono">{quote.number}</span>
              <span data-testid="quote-status">
                <QuoteStatusBadge status={quote.status} label={t(`quoteStatus.${quote.status}`)} />
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{quote.title}</h1>
            <p className="text-muted-foreground text-sm">
              <Link
                href={`/customers/${quote.customer.id}`}
                className="hover:text-foreground font-medium underline-offset-2 hover:underline"
              >
                {quote.customer.name}
              </Link>
              {quote.site ? ` · ${quote.site.label}, ${quote.site.address.city}` : ""}
            </p>
          </div>
          <QuoteActions
            id={quote.id}
            number={quote.number}
            status={quote.status}
            contactId={quote.contactId}
            jobNumber={jobNumber}
            contacts={data.contacts
              .filter((c): c is typeof c & { email: string } => Boolean(c.email))
              .map((c) => ({ id: c.id, name: c.name, email: c.email }))}
          />
        </div>
      </div>

      {quote.status === "draft" ? (
        <QuoteForm
          quote={{
            id: quote.id,
            version: quote.version,
            customer: quote.customer,
            siteId: quote.siteId,
            contactId: quote.contactId,
            serviceTypeId: quote.serviceTypeId,
            title: quote.title,
            notes: quote.notes,
            validUntil: quote.validUntil,
            discountType: quote.discountType,
            discountValue: quote.discountValue,
            lines: quote.lines.map((l) => ({
              kind: l.kind,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unit_price_minor: l.unitPriceMinor,
              tax_rate_bps: l.taxRateBps,
              catalog_item_id: l.catalogItemId,
              service_type_id: l.serviceTypeId,
              expense_request_id: null,
              unit_cost_minor: null,
              markup_bps: 0,
            })),
          }}
          initialCustomer={quote.customer}
          initialParties={form.parties}
          currency={form.currency}
          taxRates={form.taxRates}
          services={form.services}
          defaultValidUntil={form.defaultValidUntil}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t("lines.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DocumentLines lines={quote.lines} currency={quote.currency} totals={quote} />
              {quote.notes ? <p className="text-sm whitespace-pre-line">{quote.notes}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("quote.details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Item label={t("form.contact")}>
                  {quote.contact
                    ? `${quote.contact.name}${quote.contact.email ? ` · ${quote.contact.email}` : ""}`
                    : "—"}
                </Item>
                <Item label={t("form.serviceType")}>{quote.serviceType?.name ?? "—"}</Item>
                <Item label={t("form.validUntil")}>{dayText(quote.validUntil, locale)}</Item>
                <Item label={t("quote.sentAt")}>{formatDateTime(quote.sentAt, tz)}</Item>
                {quote.viewedAt ? (
                  <Item label={tp("viewed")}>{formatDateTime(quote.viewedAt, tz, locale)}</Item>
                ) : null}
                {quote.decidedAt ? (
                  <Item label={t("quote.decidedAt")}>
                    {formatDateTime(quote.decidedAt, tz)}
                    {quote.decidedByName ? ` · ${quote.decidedByName}` : ""}
                  </Item>
                ) : null}
                {quote.declineReason ? (
                  <Item label={t("quote.declineReason")}>{quote.declineReason}</Item>
                ) : null}
                {jobNumber ? (
                  <Item label={t("quote.job")}>
                    <Link href={`/jobs/${jobNumber}`} className="text-primary font-mono hover:underline">
                      {jobNumber}
                    </Link>
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
