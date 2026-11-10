import type { JobStatus } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { StatusBadge } from "@/components/app/badges";

/** A job status in the customer's words ("On the way" rather than "En route"). */
export async function PortalStatus({ status }: { status: JobStatus }) {
  const t = await getTranslations("portal.status");
  return <StatusBadge status={status} label={t(status)} />;
}
