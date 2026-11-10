import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, resolveActor } from "@/server/context";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your organization" };

/** First sign-in: create the organization; the creator becomes its Owner (AUTH-03). */
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (await resolveActor(session.user.id, session.session.activeOrganizationId)) redirect("/dashboard");
  return <OnboardingForm name={session.user.name} />;
}
