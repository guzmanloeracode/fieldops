import { catalog } from "@fieldops/core";
import type { Metadata } from "next";
import { requireActor, runService } from "@/server/context";
import { BillingSettingsForm } from "./billing-form";

export const metadata: Metadata = { title: "Billing settings" };

/** Payment terms, quote validity, labor rate, numbering, reminders and payment instructions. Owners and admins. */
export default async function BillingSettingsPage() {
  const actor = await requireActor();
  const s = await runService((ctx) => catalog.getBillingSettings(ctx), actor);
  return <BillingSettingsForm currency={s.currency} settings={s.billing} />;
}
