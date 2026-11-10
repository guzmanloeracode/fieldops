import { schema } from "@fieldops/db";
import { and, desc, eq } from "drizzle-orm";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { EmptyState } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { emailLinks } from "@/lib/email-links";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireActor } from "@/server/context";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Demo outbox" };

const KINDS = ["verify_email", "reset_password", "invitation"] as const;

/** Emails captured instead of sent in the public demo (DEM-05). Owners and admins only (enforced by the layout). */
export default async function DemoOutboxPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (!env.DEMO_MODE) notFound();
  const actor = await requireActor();
  const t = await getTranslations("settings.demoOutbox");
  const { id } = await searchParams;
  const selectedId = z.uuid().safeParse(id).success ? id : undefined;

  const emails = await db
    .select({
      id: schema.emailOutbox.id,
      toEmail: schema.emailOutbox.toEmail,
      subject: schema.emailOutbox.subject,
      kind: schema.emailOutbox.kind,
      createdAt: schema.emailOutbox.createdAt,
    })
    .from(schema.emailOutbox)
    .where(eq(schema.emailOutbox.organizationId, actor.organizationId))
    .orderBy(desc(schema.emailOutbox.createdAt))
    .limit(50);

  const selected = selectedId
    ? (
        await db
          .select({
            subject: schema.emailOutbox.subject,
            html: schema.emailOutbox.html,
            toEmail: schema.emailOutbox.toEmail,
          })
          .from(schema.emailOutbox)
          .where(
            and(
              eq(schema.emailOutbox.id, selectedId),
              eq(schema.emailOutbox.organizationId, actor.organizationId),
            ),
          )
      )[0]
    : undefined;

  const kindLabel = (k: string) =>
    (KINDS as readonly string[]).includes(k) ? t(`kinds.${k as (typeof KINDS)[number]}`) : k;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {emails.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t("empty")} description={t("emptyHint")} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
            <ul className="divide-y rounded-lg border" aria-label={t("title")}>
              {emails.map((e) => {
                const active = e.id === selectedId;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/settings/demo-outbox?id=${e.id}`}
                      aria-current={active ? "true" : undefined}
                      className={cn("block px-3 py-2.5 hover:bg-muted/60", active && "bg-muted")}
                    >
                      <span className="block truncate text-sm font-medium">{e.subject}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {kindLabel(e.kind)} · {e.toEmail}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {formatDateTime(e.createdAt, actor.organization.timezone)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="min-h-80 overflow-hidden rounded-lg border">
              {selected ? (
                <>
                  <div className="border-b px-3 py-2 text-sm">
                    <p className="font-medium">{selected.subject}</p>
                    <p className="text-muted-foreground text-xs">{selected.toEmail}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {emailLinks(selected.html).map((l) => (
                        <Button key={l.href} asChild size="sm" variant="outline">
                          <a href={l.href}>{l.label}</a>
                        </Button>
                      ))}
                    </div>
                  </div>
                  {/* Rendered in a fully sandboxed frame: no scripts, no same-origin access, links don't navigate the app. */}
                  <iframe
                    title={t("previewTitle", { subject: selected.subject })}
                    sandbox=""
                    srcDoc={selected.html}
                    className="h-[32rem] w-full bg-white"
                  />
                </>
              ) : (
                <p className="text-muted-foreground flex h-full min-h-80 items-center justify-center p-6 text-center text-sm">
                  {t("select")}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
