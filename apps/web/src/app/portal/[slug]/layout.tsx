import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { initials } from "@/lib/format";
import { getPortalActor, getPortalOrg } from "@/server/portal/session";
import { portalSignOutAction } from "./actions";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const org = await getPortalOrg((await params).slug);
  const t = await getTranslations("portal");
  return {
    title: { absolute: org ? t("title", { org: org.name }) : "FieldOps" },
    robots: { index: false, follow: false },
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The customer portal shell (POR-01): the business's name and brand color, no FieldOps app chrome. A missing
 * organization is a 404 here, before any page streams.
 */
export default async function PortalLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { slug } = await params;
  const org = await getPortalOrg(slug);
  if (!org) notFound();
  const actor = await getPortalActor(slug);
  const t = await getTranslations("portal");
  const brand = org.brandColor && HEX.test(org.brandColor) ? org.brandColor : "#0369a1";
  return (
    <div className="bg-muted/40 flex min-h-dvh flex-col">
      {env.DEMO_MODE ? (
        <div className="bg-primary text-primary-foreground px-4 py-1.5 text-center text-xs">
          {t("demoBanner")}
        </div>
      ) : null}
      <div aria-hidden className="h-1" style={{ backgroundColor: brand }} />
      <header className="bg-background border-b">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <Link href={`/portal/${org.slug}`} className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-slate-900"
              style={{ backgroundColor: `color-mix(in srgb, ${brand} 22%, white)` }}
            >
              {initials(org.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{org.name}</span>
              {actor ? (
                <span className="text-muted-foreground block truncate text-xs">
                  {t("signedInAs", { name: actor.contactName })}
                </span>
              ) : null}
            </span>
          </Link>
          {actor ? (
            <form action={portalSignOutAction.bind(null, org.slug)}>
              <Button type="submit" variant="ghost" size="sm" data-testid="portal-sign-out">
                {t("signOut")}
              </Button>
            </form>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">{children}</main>
      <footer className="text-muted-foreground flex flex-col items-center gap-2 px-4 pb-6 text-center text-xs">
        <LanguageSwitcher />
        <span>{t("poweredBy")}</span>
      </footer>
    </div>
  );
}
