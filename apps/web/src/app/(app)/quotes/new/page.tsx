import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { requireActor, runService } from "@/server/context";
import { billingFormData } from "@/components/billing/form-data";
import { QuoteForm } from "../_components/quote-form";

export const metadata: Metadata = { title: "New quote" };

/** A new quote (FIN-02), optionally for a customer (`?customer=`). Office roles; the layout checks. */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const actor = await requireActor();
  const t = await getTranslations("billing");
  const { customer } = await searchParams;
  const data = await runService((ctx) => billingFormData(ctx, customer ?? null), actor);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("quotes.new")} description={t("quotes.newDescription")} />
      <QuoteForm
        initialCustomer={data.customer}
        initialParties={data.parties}
        currency={data.currency}
        taxRates={data.taxRates}
        services={data.services}
        defaultValidUntil={data.defaultValidUntil}
      />
    </div>
  );
}
