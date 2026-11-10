"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** The signed-in portal's sections (POR-03, POR-04): jobs (the home page), quotes and invoices. */
export function PortalNav({ slug }: { slug: string }) {
  const t = useTranslations("pay.nav");
  const pathname = usePathname();
  const base = `/portal/${slug}`;
  const items = [
    { href: base, label: t("jobs"), active: (p: string) => p === base || p.startsWith(`${base}/jobs`) },
    { href: `${base}/quotes`, label: t("quotes"), active: (p: string) => p.startsWith(`${base}/quotes`) },
    {
      href: `${base}/invoices`,
      label: t("invoices"),
      active: (p: string) => p.startsWith(`${base}/invoices`),
    },
  ];
  return (
    <nav aria-label={t("label")} className="mx-auto flex max-w-2xl gap-1 px-4" data-testid="portal-nav">
      {items.map((item) => {
        const current = item.active(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring -mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
              current
                ? "border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
