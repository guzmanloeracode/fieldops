import { sla } from "@fieldops/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireActor, runService } from "@/server/context";
import { SlaForm } from "./sla-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("sla") };
}

/** Response and resolution targets per priority (SLA-01, SET-03). Owners and admins; the layout checks. */
export default async function SlaSettingsPage() {
  const actor = await requireActor();
  const policies = await runService((ctx) => sla.listPolicies(ctx), actor);
  return (
    <SlaForm
      policies={policies.map((p) => ({
        priority: p.priority,
        responseMin: p.responseMin,
        resolutionMin: p.resolutionMin,
        businessHours: p.businessHours,
        isDefault: p.isDefault,
      }))}
    />
  );
}
