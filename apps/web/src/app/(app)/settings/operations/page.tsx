import { organization } from "@fieldops/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireActor, runService } from "@/server/context";
import { OperationsForm } from "./operations-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("operations") };
}

/** Approval thresholds (EXP-02) and the completion signature rule (JOB-10). Owners and admins. */
export default async function OperationsSettingsPage() {
  const actor = await requireActor();
  const settings = await runService((ctx) => organization.getOperationsSettings(ctx), actor);
  return (
    <OperationsForm
      currency={settings.currency}
      autoApproveBelowMinor={settings.approval.autoApproveBelowMinor}
      dispatcherLimitMinor={settings.approval.dispatcherLimitMinor}
      requireSignature={settings.requireSignature}
    />
  );
}
