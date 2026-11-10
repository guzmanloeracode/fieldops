"use client";
import { formatJobNumber, STATUS_LABELS, type SearchHits } from "@fieldops/core";
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  LayoutDashboard,
  Loader2,
  MapPin,
  Plus,
  Search,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchAction } from "@/app/(app)/search-action";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const OPEN_EVENT = "fieldops:open-palette";

/** Opens the command palette (the header buttons; ⌘K / Ctrl+K works anywhere). */
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function SearchButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useTranslations("insights.palette");
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  if (compact) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("openHint")}
        onClick={openPalette}
        className={className}
      >
        <Search />
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      onClick={openPalette}
      data-testid="palette-open"
      className={cn("text-muted-foreground w-full justify-start gap-2 font-normal", className)}
      aria-label={t("openHint")}
    >
      <Search className="size-4" aria-hidden />
      <span className="flex-1 text-left">{t("open")}</span>
      <kbd className="bg-muted rounded border px-1.5 font-mono text-[10px]">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </Button>
  );
}

type ActionItem = { key: string; href: string; icon: typeof Search; when: "all" | "office" | "managers" };
const ACTIONS: ActionItem[] = [
  { key: "newJob", href: "/jobs/new", icon: Plus, when: "office" },
  { key: "newCustomer", href: "/customers/new", icon: Plus, when: "office" },
  { key: "board", href: "/schedule", icon: CalendarDays, when: "office" },
  { key: "approvals", href: "/approvals", icon: BadgeCheck, when: "office" },
  { key: "myDay", href: "/jobs?view=my-day", icon: CalendarClock, when: "all" },
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard, when: "all" },
  { key: "jobs", href: "/jobs", icon: Briefcase, when: "all" },
  { key: "customers", href: "/customers", icon: Building2, when: "all" },
  { key: "organization", href: "/settings/organization", icon: Settings, when: "managers" },
  { key: "members", href: "/settings/members", icon: Users, when: "managers" },
  { key: "serviceTypes", href: "/settings/service-types", icon: Wrench, when: "managers" },
];

const EMPTY: SearchHits = { jobs: [], customers: [], sites: [] };

/** ⌘K command palette (JOB-11): search jobs, customers and sites, or jump to a page. */
export function CommandPalette({ role }: { role: string }) {
  const t = useTranslations("insights.palette");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHits>(EMPTY);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(EMPTY);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await searchAction(term);
      if (id !== seq.current) return;
      setHits(res.ok ? res.data : EMPTY);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQ("");
      router.push(href);
    },
    [router],
  );

  const office = role !== "technician";
  const managers = role === "owner" || role === "admin";
  const term = q.trim().toLowerCase();
  const actions = ACTIONS.filter(
    (a) => a.when === "all" || (a.when === "office" && office) || (a.when === "managers" && managers),
  )
    .map((a) => ({ ...a, label: t(`action.${a.key}`) }))
    .filter((a) => !term || a.label.toLowerCase().includes(term));
  const anyHits = hits.jobs.length + hits.customers.length + hits.sites.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("description")}</DialogDescription>
        <Command
          shouldFilter={false}
          label={t("title")}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium"
        >
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={t("placeholder")}
            data-testid="palette-input"
            className="h-12"
          />
          <CommandList className="max-h-[60dvh]">
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-sm" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {t("searching")}
              </div>
            ) : null}
            {!loading && term.length >= 2 && !anyHits && actions.length === 0 ? (
              <CommandEmpty>{t("empty")}</CommandEmpty>
            ) : null}
            {hits.jobs.length ? (
              <CommandGroup heading={t("jobs")}>
                {hits.jobs.map((j) => (
                  <CommandItem
                    key={j.id}
                    value={`job-${j.id}`}
                    onSelect={() => go(`/jobs/${formatJobNumber(j.number)}`)}
                    data-testid="palette-job"
                  >
                    <Briefcase aria-hidden />
                    <span className="font-mono text-xs">{formatJobNumber(j.number)}</span>
                    <span className="min-w-0 flex-1 truncate">{j.title}</span>
                    <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                      {j.customerName} · {STATUS_LABELS[j.status]}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {hits.customers.length ? (
              <CommandGroup heading={t("customers")}>
                {hits.customers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`customer-${c.id}`}
                    onSelect={() => go(`/customers/${c.id}`)}
                  >
                    <Building2 aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.city ? <span className="text-muted-foreground text-xs">{c.city}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {hits.sites.length ? (
              <CommandGroup heading={t("sites")}>
                {hits.sites.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`site-${s.id}`}
                    onSelect={() => go(`/customers/${s.customerId}`)}
                  >
                    <MapPin aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {s.line1}, {s.city}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {s.customerName} · {s.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {actions.length ? (
              <CommandGroup heading={t("actions")}>
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <CommandItem key={a.key} value={`action-${a.key}`} onSelect={() => go(a.href)}>
                      <Icon aria-hidden />
                      {a.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {term.length === 1 ? (
              <p className="text-muted-foreground px-4 py-3 text-sm">{t("typeMore")}</p>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
