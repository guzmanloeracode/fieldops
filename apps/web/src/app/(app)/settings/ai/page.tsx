import { ai } from "@fieldops/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { aiLimits, intakeModel } from "@/server/ai";
import { requireActor, runService } from "@/server/context";
import { AiSettingsForm } from "./ai-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("ai") };
}

/** AI on or off, the monthly quota and this month's use (SET-04, §9.7). Owners and admins (settings layout). */
export default async function AiSettingsPage() {
  const actor = await requireActor();
  const settings = await runService((ctx) => ai.getAiSettings(ctx, intakeModel.provider), actor);
  return (
    <AiSettingsForm
      enabled={settings.enabled}
      monthlyQuota={settings.monthlyQuota}
      provider={settings.provider}
      model={intakeModel.model}
      usage={settings.usage}
      acceptanceRate={settings.acceptanceRate}
      limits={aiLimits}
    />
  );
}
