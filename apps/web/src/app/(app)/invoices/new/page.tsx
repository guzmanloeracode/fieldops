import { formatJobNumber, invoices } from "@fieldops/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { billingFormData } from "@/components/billing/form-data";
import { Button } from "@/components/ui/button";
import { requireActor, runService } from "@/server/context";
import { InvoiceForm } from "../_components/invoice-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("newInvoice") };
}

/**
 * A new invoice (FIN-03): `?job=` prefills the lines from a completed job (service or approved quote, labor,
 * approved parts); `?customer=` starts a blank invoice for a customer. Office roles; the layout checks.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; customer?: string }>;
}) {
  const actor = await requireActor();
  const t = await getTranslations("billing");
  const { job, customer } = await searchParams;
  const data = await runService(async (ctx) => {
    const prefill = job ? await invoices.prefillFromJob(ctx, job).catch(() => null) : null;
    const form = await billingFormData(ctx, prefill?.customerId ?? customer ?? null);
    return { prefill, form };
  }, actor);
  if (job && !data.prefill) notFound();
  const { prefill, form } = data;
  const jobNumber = prefill ? formatJobNumber(prefill.job.number) : null;

  if (prefill && prefill.job.status !== "completed") {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t("invoices.new")} />
        <EmptyState
          title={t("invoices.jobNotCompleted", { job: jobNumber! })}
          description={t("invoices.jobNotCompletedHint")}
          action={
            <Button asChild variant="outline">
              <Link href={`/jobs/${jobNumber}`}>{t("invoices.backToJob", { job: jobNumber! })}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("invoices.new")}
        description={
          prefill
            ? prefill.quote
              ? t("invoices.newForJobFromQuote", { job: jobNumber!, quote: prefill.quote.number })
              : t("invoices.newForJob", { job: jobNumber! })
            : t("invoices.newDescription")
        }
      />
      <InvoiceForm
        initial={{
          customer: form.customer,
          parties: form.parties,
          siteId: prefill?.siteId ?? null,
          contactId:
            prefill?.contactId ??
            form.parties?.contacts.find((c) => c.isPrimary && c.email)?.id ??
            form.parties?.contacts.find((c) => c.email)?.id ??
            null,
          notes: null,
          discountType: prefill?.discountType ?? null,
          discountValue: prefill?.discountValue ?? 0,
          lines: prefill?.lines ?? [],
          jobId: prefill?.job.id ?? null,
        }}
        currency={form.currency}
        taxRates={form.taxRates}
        services={form.services}
      />
    </div>
  );
}
