import { schema } from "@fieldops/db";
import { desc, inArray } from "drizzle-orm";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { emailLinks } from "@/lib/email-links";
import { db } from "@/server/db";
import { demoInboxAddresses } from "@/server/demo-inbox";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("demoInbox"), robots: { index: false } };
}
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
            <div key={m.id} className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{m.subject}</p>
                <p className="text-muted-foreground text-xs">{t("inbox.to", { email: m.toEmail })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {emailLinks(m.html).map((l) => (
                  <Button key={l.href} asChild size="sm">
                    <a href={l.href}>{l.label}</a>
                  </Button>
                ))}
              </div>
              <details open={m === emails[0]}>
                <summary className="text-muted-foreground cursor-pointer text-xs">
                  {t("inbox.preview")}
                </summary>
                <iframe
                  title={m.subject}
                  srcDoc={m.html}
                  sandbox=""
                  className="mt-2 h-96 w-full rounded border bg-white"
                />
              </details>
            </div>
          ))
        )}
        <Link href="/sign-in" className="text-primary block text-center text-sm hover:underline">
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </Card>
  );
}
