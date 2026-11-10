import { organization } from "@fieldops/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireActor, runService } from "@/server/context";
import { timeZones } from "@/lib/countries";
import { OrganizationForm } from "./organization-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("organization") };
}

export default async function OrganizationSettingsPage() {
  const actor = await requireActor();
  const org = await runService((ctx) => organization.getOrganization(ctx), actor);
  return (
    <OrganizationForm
      timeZones={timeZones()}
      org={{
        name: org.name,
        slug: org.slug,
        timezone: org.timezone,
        currency: org.currency,
        country: org.country,
        brandColor: org.brandColor,
        address: org.address,
        businessHours: org.businessHours,
        taxRates: org.taxRates,
        locale: org.settings.locale,
      }}
    />
  );
}
