import { DEMO_PORTAL_LOGINS } from "@fieldops/db/seed";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { getPortalActor, getPortalOrg } from "@/server/portal/session";
import { demoPortalSignInAction } from "../actions";
import { PortalSignInForm } from "./sign-in-form";

/** Portal sign-in with a one-time email link (POR-01), and one click as the demo customer in the demo. */
export default async function PortalSignInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = (await getPortalOrg(slug))!;
  if (await getPortalActor(slug)) redirect(`/portal/${slug}`);
  const t = await getTranslations("portal.signIn");
  const demo =
    env.DEMO_MODE && org.isDemo ? DEMO_PORTAL_LOGINS[org.slug as keyof typeof DEMO_PORTAL_LOGINS] : null;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>{t("title")}</h1>
          </CardTitle>
          <CardDescription>{t("description", { org: org.name })}</CardDescription>
        </CardHeader>
        <CardContent>
          <PortalSignInForm slug={org.slug} orgName={org.name} demo={env.DEMO_MODE} />
        </CardContent>
      </Card>
      {demo ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>{t("demoTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("demoDescription", { name: demo.name, org: org.name })}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={demoPortalSignInAction.bind(null, org.slug)}>
              <Button type="submit" variant="outline" className="w-full" data-testid="portal-demo-sign-in">
                {t("demoButton", { name: demo.name })}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
