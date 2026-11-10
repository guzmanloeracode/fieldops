"use client";
import type { Role } from "@fieldops/shared";
import { CheckCircle2, Circle, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// "Try these 5 things" (DEM-06): a short, dismissible checklist for demo visitors, per role. What a visitor
// tried and whether they hid the card stay in this browser (localStorage) only.

const ITEMS: Record<"owner" | "dispatcher" | "technician", { key: string; href: (org: string) => string }[]> =
  {
    owner: [
      { key: "kpis", href: () => "/dashboard?tab=overview" },
      { key: "approvals", href: () => "/approvals" },
      { key: "audit", href: () => "/settings/audit" },
      { key: "portal", href: (org) => `/portal/${org}/sign-in` },
      { key: "settings", href: () => "/settings/operations" },
    ],
    dispatcher: [
      { key: "board", href: () => "/schedule" },
      { key: "review", href: () => "/jobs?status=new" },
      { key: "today", href: () => "/dashboard?tab=today" },
      { key: "search", href: () => "/jobs" },
      { key: "export", href: () => "/jobs" },
    ],
    technician: [
      { key: "myDay", href: () => "/jobs?view=my-day" },
      { key: "start", href: () => "/jobs?view=my-day" },
      { key: "checklist", href: () => "/jobs?view=my-day" },
      { key: "part", href: () => "/jobs?view=my-day" },
      { key: "complete", href: () => "/jobs?view=my-day" },
    ],
  };

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the tour still works for this page view.
  }
}

export function DemoTour({ role, roleLabel, orgSlug }: { role: Role; roleLabel: string; orgSlug: string }) {
  const t = useTranslations("tour");
  const group = role === "admin" ? "owner" : role;
  const storageKey = `fieldops-tour:${group}`;
  // Hidden until the browser says otherwise, so a dismissed tour never flashes.
  const [state, setState] = useState<{ hidden: boolean; done: string[] }>({ hidden: true, done: [] });
  useEffect(() => {
    const raw = read(storageKey);
    const saved = raw ? (JSON.parse(raw) as { hidden?: boolean; done?: string[] }) : {};
    setState({ hidden: Boolean(saved.hidden), done: saved.done ?? [] });
  }, [storageKey]);
  const save = (next: { hidden: boolean; done: string[] }) => {
    setState(next);
    write(storageKey, JSON.stringify(next));
  };
  if (state.hidden) return null;
  const items = ITEMS[group];
  return (
    <section
      aria-labelledby="demo-tour-title"
      className="bg-card relative rounded-xl border p-4 sm:p-5"
      data-testid="demo-tour"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2"
        aria-label={t("dismiss")}
        onClick={() => save({ ...state, hidden: true })}
      >
        <X aria-hidden />
      </Button>
      <h2 id="demo-tour-title" className="flex items-center gap-2 pr-10 font-semibold">
        <Sparkles aria-hidden className="text-primary size-4" /> {t("title")}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("description", { role: roleLabel })}{" "}
        {t("progress", { done: state.done.length, total: items.length })}
      </p>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {items.map((item) => {
          const done = state.done.includes(item.key);
          return (
            <li key={item.key}>
              <Link
                href={item.href(orgSlug)}
                onClick={() => !done && save({ ...state, done: [...state.done, item.key] })}
                className="hover:bg-accent focus-visible:ring-ring flex items-start gap-2 rounded-md p-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                {done ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <Circle aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                )}
                <span className={done ? "text-muted-foreground line-through" : undefined}>
                  {t(`${group}.${item.key}`)}
                  {done ? <span className="sr-only"> ({t("done")})</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
