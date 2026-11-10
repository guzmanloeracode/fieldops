"use client";
import {
  BadgeCheck,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  FileText,
  LayoutDashboard,
  Receipt,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSidebar } from "@/components/app/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  /** Key in `common.nav`. */
  label: string;
  icon: typeof Briefcase;
  soon?: string;
  office?: boolean;
  managers?: boolean;
  external?: boolean;
};

const ITEMS: Item[] = [
  { href: "/dashboard", label: "home", icon: LayoutDashboard },
  { href: "/jobs", label: "jobs", icon: Briefcase },
  { href: "/schedule", label: "schedule", icon: CalendarDays, office: true },
  { href: "/approvals", label: "approvals", icon: BadgeCheck, office: true },
  { href: "/customers", label: "customers", icon: Building2 },
  { href: "/quotes", label: "quotes", icon: FileText, office: true },
  { href: "/invoices", label: "invoices", icon: Receipt, office: true },
];
const SETTINGS: Item[] = [
  { href: "/settings/organization", label: "organization", icon: Settings, managers: true },
  { href: "/settings/members", label: "members", icon: Users, managers: true },
  { href: "/settings/service-types", label: "serviceTypes", icon: Wrench, managers: true },
  { href: "/docs/api", label: "apiReference", icon: BookOpen, external: true },
];

export function Nav({
  role,
  onNavigate,
  counts = {},
}: {
  role: string;
  onNavigate?: () => void;
  /** Badges next to items, by href (e.g. pending approvals). */
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();
  const t = useTranslations("common.nav");
  // Collapsed to icons: labels stay for screen readers and show as tooltips, badges become a dot.
  const { collapsed } = useSidebar();
  const office = role !== "technician";
  const managers = role === "owner" || role === "admin";
  const visible = (i: Item) => (!i.office || office) && (!i.managers || managers);
  const render = (i: Item) => {
    const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
    const Icon = i.icon;
    const label = t(i.label);
    if (i.soon) {
      return (
        <li key={i.href}>
          <span
            className="text-muted-foreground/70 flex items-center gap-3 rounded-md px-3 py-2 text-sm"
            aria-disabled
          >
            <Icon className="size-4" aria-hidden />
            {label}
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{i.soon}</span>
          </span>
        </li>
      );
    }
    const count = counts[i.href];
    const link = (
      <Link
        href={i.href}
        onClick={onNavigate}
        {...(i.external ? { target: "_blank", rel: "noreferrer" } : {})}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-md py-2 text-sm transition-colors",
          collapsed ? "justify-center px-2" : "px-3",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className={collapsed ? "sr-only" : undefined}>
          {label}
          {collapsed && count ? `, ${t("pending", { count })}` : null}
        </span>
        {count && collapsed ? (
          <span className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full" aria-hidden />
        ) : count ? (
          <span className="bg-primary text-primary-foreground ml-auto rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums">
            <span aria-hidden>{count}</span>
            <span className="sr-only">{t("pending", { count })}</span>
          </span>
        ) : null}
      </Link>
    );
    return (
      <li key={i.href}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{count ? `${label} (${count})` : label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        )}
      </li>
    );
  };
  return (
    <nav aria-label={t("main")} className="flex flex-1 flex-col gap-6">
      <ul className="space-y-0.5">{ITEMS.filter(visible).map(render)}</ul>
      <div>
        {collapsed ? <div className="border-sidebar-border mx-2 mb-2 border-t" aria-hidden /> : null}
        <p
          className={cn(
            "text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wide uppercase",
            collapsed && "sr-only",
          )}
        >
          {t("workspace")}
        </p>
        <ul className="space-y-0.5">{SETTINGS.filter(visible).map(render)}</ul>
      </div>
    </nav>
  );
}
