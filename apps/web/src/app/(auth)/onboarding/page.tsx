import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession, resolveActor } from "@/server/context";
import { OnboardingForm } from "./onboarding-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("onboarding") };
}

/**
 * First sign-in: create the organization; the creator becomes its Owner (AUTH-03). Members of an
 * organization come here with ?new=1 to create another one (AUTH-06); shared demo accounts can't.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const another = (await searchParams).new === "1" && !session.user.isDemo;
  if (!another && (await resolveActor(session.user.id, session.session.activeOrganizationId))) {
    redirect("/dashboard");
  }
  return <OnboardingForm name={session.user.name} />;
}
