import type { InvoiceStatus, QuoteStatus } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { InvoiceStatusBadge, QuoteStatusBadge } from "@/components/billing/status-badges";

// Quote and invoice statuses in the customer's words (POR-04): "Waiting for you" rather than "Sent".

export async function PortalQuoteStatus({ status }: { status: QuoteStatus }) {
  const t = await getTranslations("pay.status.quote");
  return <QuoteStatusBadge status={status} label={t(status)} />;
}

export async function PortalInvoiceStatus({ status }: { status: InvoiceStatus }) {
  const t = await getTranslations("pay.status.invoice");
  return <InvoiceStatusBadge status={status} label={t(status)} />;
}
