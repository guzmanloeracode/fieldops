import { organization } from "@fieldops/core";
import type { Metadata } from "next";
import { requireActor, runService } from "@/server/context";
import { timeZones } from "@/lib/countries";
import { OrganizationForm } from "./organization-form";

export const metadata: Metadata = { title: "Organization settings" };

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
      }}
    />
  );
}
