import { can } from "@fieldops/core";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { env } from "@/env";
import { requireActor } from "@/server/context";
import { SettingsNav } from "./settings-nav";

/** Settings are for owners and admins (SET-01/02). Everyone else gets a 404 rather than a hint that the page exists. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!can(actor, "org.update")) notFound();
  const t = await getTranslations("settings");
  const te = await getTranslations("expenses.settings");
  const tabs = [
    { href: "/settings/organization", label: t("tabs.organization") },
    { href: "/settings/members", label: t("tabs.members") },
    { href: "/settings/service-types", label: t("tabs.serviceTypes") },
    { href: "/settings/catalog", label: t("tabs.catalog") },
    { href: "/settings/billing", label: t("tabs.billing") },
    { href: "/settings/operations", label: te("tab") },
    { href: "/settings/sla", label: t("tabs.sla") },
    { href: "/settings/ai", label: t("tabs.ai") },
    { href: "/settings/api-keys", label: t("tabs.apiKeys") },
    { href: "/settings/webhooks", label: t("tabs.webhooks") },
    { href: "/settings/audit", label: t("tabs.audit") },
    ...(env.DEMO_MODE ? [{ href: "/settings/demo-outbox", label: t("tabs.demoOutbox") }] : []),
  ];
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsNav tabs={tabs} />
      <div className="pt-6">{children}</div>
    </>
  );
}
