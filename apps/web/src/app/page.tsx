import {
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Database,
  GitBranch,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DemoSignIn } from "@/components/app/demo-sign-in";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { getSession } from "@/server/context";

export const metadata: Metadata = {
  title: { absolute: "FieldOps: open-source field service management" },
  description:
    "Requests, dispatch, on-site work, reports and payments for small service businesses. Open-source portfolio project with a live demo.",
};

const RELEASES = ["r01", "r02", "r03", "r04", "relay", "r05", "site", "mobile"] as const;
const HIGHLIGHTS = [
  { key: "tenancy", icon: ShieldCheck },
  { key: "contracts", icon: Workflow },
  { key: "lifecycle", icon: GitBranch },
  { key: "selfHosted", icon: Database },
] as const;

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const session = await getSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo /> FieldOps
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1 text-sm sm:gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/docs/api">
              <BookOpen /> <span className="hidden sm:inline">{t("nav.api")}</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={env.GITHUB_URL} target="_blank" rel="noreferrer">
              <GitBranch /> <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          <Button size="sm" asChild>
            <Link href={session ? "/dashboard" : "/sign-in"}>
              {session ? t("nav.openApp") : t("nav.signIn")}
            </Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:pt-16">
          <div className="space-y-6">
            <p className="text-primary inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
              <span className="bg-primary size-1.5 rounded-full" aria-hidden />{" "}
              {t("hero.badge", { version: env.APP_VERSION })}
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t("hero.title")}
            </h1>
            <p className="text-muted-foreground max-w-xl text-lg text-pretty">{t("hero.subtitle")}</p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/sign-up">
                  {t("hero.start")} <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/docs/api">{t("hero.api")}</Link>
              </Button>
            </div>
          </div>
          {env.DEMO_MODE ? (
            <div className="bg-card space-y-4 rounded-2xl border p-5 shadow-sm">
              <div>
                <p className="font-medium">{t("demo.title")}</p>
                <p className="text-muted-foreground text-sm">{t("demo.description")}</p>
              </div>
              <DemoSignIn org="acme-air" />
              <details className="text-sm">
                <summary className="text-primary cursor-pointer">{t("demo.indonesian")}</summary>
                <div className="pt-3">
                  <DemoSignIn org="acme-teknik" />
                </div>
              </details>
              <p className="text-muted-foreground text-xs">{t("demo.reset")}</p>
            </div>
          ) : null}
        </section>

        <section className="bg-muted/40 border-y">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {HIGHLIGHTS.map(({ key, icon: Icon }) => (
              <div key={key} className="space-y-2">
                <Icon className="text-primary size-6" aria-hidden />
                <h2 className="font-medium">{t(`highlights.${key}.title`)}</h2>
                <p className="text-muted-foreground text-sm">{t(`highlights.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t("roadmap.title")}</h2>
          <p className="text-muted-foreground mt-1 mb-6 text-sm">{t("roadmap.subtitle")}</p>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {RELEASES.map((r, i) => (
              <li
                key={r}
                className={`rounded-xl border p-4 ${i === 0 ? "border-primary/50 bg-primary/5" : ""}`}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  {i === 0 ? (
                    <CheckCircle2 className="text-primary size-4" aria-hidden />
                  ) : (
                    <span className="bg-muted-foreground/40 size-2 rounded-full" aria-hidden />
                  )}
                  {t(`roadmap.${r}.name`)}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">{t(`roadmap.${r}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-2">
            <Building2 className="size-4" aria-hidden /> {t("footer.portfolio")}
          </p>
          <p>
            v{env.APP_VERSION} · {env.APP_COMMIT.slice(0, 7)}
          </p>
        </div>
      </footer>
    </div>
  );
}
