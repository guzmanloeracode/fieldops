import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPortalOrg } from "@/server/portal/session";
import { RedeemForm } from "./redeem-form";

/**
 * The page a sign-in link opens. Signing in takes a click, so link scanners that open every URL in an email
 * can't use up the one-time link.
 */
export default async function PortalAuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("portal.auth");
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t("title", { org: org.name })}</h1>
        </CardTitle>
        <CardDescription>{token ? t("description") : t("missing")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {token ? <RedeemForm slug={org.slug} token={token} /> : null}
        <Link
          href={`/portal/${org.slug}/sign-in`}
          className="text-primary block text-center text-sm hover:underline"
        >
          {t("newLink")}
        </Link>
      </CardContent>
    </Card>
  );
}
