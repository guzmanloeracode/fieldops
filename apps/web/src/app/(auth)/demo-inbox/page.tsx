import { schema } from "@fieldops/db";
import { desc, inArray } from "drizzle-orm";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { db } from "@/server/db";
import { demoInboxAddresses } from "@/server/demo-inbox";

export const metadata: Metadata = { title: "Demo inbox", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Emails captured by the demo for the addresses used in this browser (DEM-05). */
export default async function DemoInboxPage() {
  if (!env.DEMO_MODE) notFound();
  const t = await getTranslations("auth");
  const addresses = await demoInboxAddresses();
  const emails = addresses.length
    ? await db
        .select()
        .from(schema.emailOutbox)
        .where(inArray(schema.emailOutbox.toEmail, addresses))
        .orderBy(desc(schema.emailOutbox.createdAt))
        .limit(10)
    : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("inbox.title")}</CardTitle>
        <CardDescription>{t("inbox.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {emails.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t("inbox.empty")} />
        ) : (
          emails.map((m) => (
            <details key={m.id} className="rounded-lg border" open={m === emails[0]}>
              <summary className="cursor-pointer p-3 text-sm">
                <span className="font-medium">{m.subject}</span>
                <span className="text-muted-foreground block text-xs">{t("inbox.to", { email: m.toEmail })}</span>
              </summary>
              <iframe title={m.subject} srcDoc={`<base target="_top">${m.html}`} sandbox="allow-popups allow-top-navigation-by-user-activation" className="h-96 w-full border-t bg-white" />
            </details>
          ))
        )}
        <Link href="/sign-in" className="text-primary block text-center text-sm hover:underline">
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </Card>
  );
}
