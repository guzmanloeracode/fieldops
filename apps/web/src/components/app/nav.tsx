"use client";
import {
  BadgeCheck,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  LayoutDashboard,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  icon: typeof Briefcase;
  soon?: string;
  office?: boolean;
  managers?: boolean;
  external?: boolean;
};

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/schedule", label: "Dispatch board", icon: CalendarDays, office: true },
  { href: "/approvals", label: "Approvals", icon: BadgeCheck, office: true },
  { href: "/customers", label: "Customers", icon: Building2 },
];
const SETTINGS: Item[] = [
  { href: "/settings/organization", label: "Organization", icon: Settings, managers: true },
  { href: "/settings/members", label: "Members", icon: Users, managers: true },
  { href: "/settings/service-types", label: "Service types", icon: Wrench, managers: true },
  { href: "/docs/api", label: "API reference", icon: BookOpen, external: true },
];

export function Nav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const office = role !== "technician";
  const managers = role === "owner" || role === "admin";
  const visible = (i: Item) => (!i.office || office) && (!i.managers || managers);
  const render = (i: Item) => {
    const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
    const Icon = i.icon;
    if (i.soon) {
      return (
        <li key={i.href}>
          <span
            className="text-muted-foreground/70 flex items-center gap-3 rounded-md px-3 py-2 text-sm"
            aria-disabled
          >
            <Icon className="size-4" aria-hidden />
            {i.label}
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{i.soon}</span>
          </span>
        </li>
      );
    }
    return (
      <li key={i.href}>
        <Link
          href={i.href}
          onClick={onNavigate}
          {...(i.external ? { target: "_blank", rel: "noreferrer" } : {})}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {i.label}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6">
      <ul className="space-y-0.5">{ITEMS.filter(visible).map(render)}</ul>
      <div>
        <p className="text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wide uppercase">
          Workspace
        </p>
        <ul className="space-y-0.5">{SETTINGS.filter(visible).map(render)}</ul>
      </div>
    </nav>
  );
}
