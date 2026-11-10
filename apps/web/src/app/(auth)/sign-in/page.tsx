import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { DemoSignIn } from "@/components/app/demo-sign-in";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleSignIn } from "@/components/app/google-sign-in";
import { env, googleConfigured } from "@/env";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("signIn") };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string }>;
}) {
  const { next, verified } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("signIn.title")}</CardTitle>
          <CardDescription>{t("signIn.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verified ? (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {t("signIn.verified")}
            </p>
          ) : null}
          {googleConfigured ? <GoogleSignIn next={next?.startsWith("/") ? next : "/dashboard"} /> : null}
          <SignInForm next={next?.startsWith("/") ? next : "/dashboard"} />
          <div className="flex justify-between text-sm">
            <Link href="/forgot-password" className="text-primary hover:underline">
              {t("signIn.forgot")}
            </Link>
            <Link href="/sign-up" className="text-primary hover:underline">
              {t("signIn.createAccount")}
            </Link>
          </div>
        </CardContent>
      </Card>
      {env.DEMO_MODE ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("demo.title")}</CardTitle>
            <CardDescription>{t("demo.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <DemoSignIn />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
