import { ai, assertCan, organization } from "@fieldops/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { intakeModel } from "@/server/ai";
import { requireActor, runService } from "@/server/context";
import { NewJobForm } from "./new-job-form";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const actor = await requireActor();
  const t = await getTranslations("jobs");
  try {
    assertCan(actor, "jobs.create");
  } catch {
    notFound();
  }
  const { customer: customerId } = await searchParams;
  const data = await runService(async (ctx) => ({
    serviceTypes: await organization.listServiceTypes(ctx),
    customer:
      customerId && /^[0-9a-f-]{36}$/i.test(customerId) ? await ctx.store.customers.get(customerId) : null,
    ai: await ai.intakeStatus(ctx, intakeModel.provider),
  }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("new.title")} description={t("new.description")} />
      <NewJobForm
        timeZone={actor.organization.timezone}
        serviceTypes={data.serviceTypes.map((s) => ({
          id: s.id,
          name: s.name,
          duration: s.defaultDurationMin,
        }))}
        initialCustomer={data.customer ? { id: data.customer.id, name: data.customer.name } : null}
        ai={data.ai}
      />
    </div>
  );
}
