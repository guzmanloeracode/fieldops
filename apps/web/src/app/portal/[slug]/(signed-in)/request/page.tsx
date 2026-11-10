import { portal } from "@fieldops/core";
import { PORTAL_MAX_DAYS_AHEAD } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { getPortalOrg, runPortal } from "@/server/portal/session";
import { RequestForm } from "./request-form";

/** Request service (POR-02): what's wrong, where, when suits, and up to three photos. */
export default async function PortalRequestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("portal.request");
  const sites = await runPortal(slug, (ctx) => portal.listPortalSites(ctx));
  const today = localToday(org.timezone);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description", { org: org.name })}</p>
      </div>
      <RequestForm
        slug={slug}
        sites={sites}
        minDate={today}
        maxDate={addDays(today, PORTAL_MAX_DAYS_AHEAD)}
      />
    </div>
  );
}

function localToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
