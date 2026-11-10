import { ROLE_LABELS } from "@fieldops/core";
import { schema } from "@fieldops/db";
import type { Role } from "@fieldops/shared";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/server/context";
import { db } from "@/server/db";
import { acceptInvitationAction } from "./actions";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("auth");
  const session = await getSession();
  const [inv] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db
        .select({ i: schema.invitation, orgName: schema.organization.name })
        .from(schema.invitation)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
        .where(eq(schema.invitation.id, id))
    : [];
  const valid = inv && inv.i.status === "pending" && (!inv.i.expiresAt || inv.i.expiresAt > new Date());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {valid ? t("invite.title", { org: inv.orgName }) : t("invite.invalidTitle")}
        </CardTitle>
        <CardDescription>
          {valid
            ? t("invite.description", {
                role: ROLE_LABELS[inv.i.role as Role] ?? inv.i.role,
                email: inv.i.email,
              })
            : t("invite.invalid")}
        </CardDescription>
      </CardHeader>
      {valid ? (
        <CardContent className="space-y-3">
          {!session ? (
            <>
              <Button asChild className="w-full">
                <Link href={`/sign-up?email=${encodeURIComponent(inv.i.email)}&next=/invite/${id}`}>
                  {t("invite.createAccount")}
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/sign-in?next=/invite/${id}`}>{t("invite.signIn")}</Link>
              </Button>
            </>
          ) : session.user.email.toLowerCase() !== inv.i.email.toLowerCase() ? (
            <p className="text-sm">{t("invite.wrongAccount", { email: inv.i.email })}</p>
          ) : (
            <form action={acceptInvitationAction}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" className="w-full" data-testid="accept-invitation">
                {t("invite.accept")}
              </Button>
            </form>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
