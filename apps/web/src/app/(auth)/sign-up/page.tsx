import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { env, googleConfigured } from "@/env";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("signUp") };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const { email, next } = await searchParams;
  return (
    <SignUpForm
      demo={env.DEMO_MODE}
      defaultEmail={email ?? ""}
      next={next?.startsWith("/") ? next : undefined}
      google={googleConfigured}
    />
  );
}
