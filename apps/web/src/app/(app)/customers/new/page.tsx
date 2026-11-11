import { can, organization } from "@fieldops/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { requireActor, runService } from "@/server/context";
import { CustomerForm } from "./customer-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("newCustomer") };
}

export default async function NewCustomerPage() {
  const actor = await requireActor();
  if (!can(actor, "customers.create")) notFound();
  const t = await getTranslations("customers");
  const org = await runService((ctx) => organization.getOrganization(ctx), actor);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <Link href="/customers" className="hover:underline">
            {t("detail.back")}
          </Link>
        }
        title={t("new")}
      />
      <CustomerForm defaultCountry={org.country} orgLocale={org.settings.locale} />
    </div>
  );
}
