import { notifications } from "@fieldops/core";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { toPreferenceDto } from "@/server/api/serialize-notifications";
import { requireActor, runService } from "@/server/context";
import { PreferencesForm } from "./preferences-form";

/** Each user's channel choices per event (NOT-03). Every role has its own list of events. */
export default async function NotificationPreferencesPage() {
  const actor = await requireActor();
  const t = await getTranslations("notifications");
  const prefs = await runService((ctx) => notifications.getPreferences(ctx), actor);
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow={
          <Link href="/notifications" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3.5" /> {t("preferences.back")}
          </Link>
        }
        title={t("preferences.title")}
        description={t("preferences.description", { email: actor.email })}
      />
      <PreferencesForm initial={prefs.map(toPreferenceDto)} />
    </div>
  );
}
