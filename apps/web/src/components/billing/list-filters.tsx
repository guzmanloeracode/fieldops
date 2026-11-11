"use client";
import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Filters for the quotes and invoices lists. Every filter lives in the URL, like the jobs list, so a view can be
 * bookmarked and shared.
 */
export function ListFilters({
  statuses,
  customer,
  dates,
}: {
  statuses: { value: string; label: string }[];
  /** The customer the list is filtered to, shown as a removable chip. */
  customer: { id: string; name: string } | null;
  /** Show the date range (invoices: issue date; quotes: created). */
  dates: { label: string } | null;
}) {
  const t = useTranslations("billing.filters");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const clearing = useRef(false);

  const update = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (clearing.current) {
      clearing.current = false;
      return;
    }
    if (q === (params.get("q") ?? "")) return;
    const id = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["q", "status", "customer", "from", "to"].some((k) => params.get(k));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" aria-busy={pending} data-testid="list-filters">
      <div className="relative w-full space-y-1 sm:w-80">
        <Label htmlFor="billing-search" className="sr-only">
          {t("search")}
        </Label>
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          id="billing-search"
          type="search"
          className="pl-8"
          placeholder={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="billing-status" className="text-muted-foreground text-xs">
          {t("status")}
        </Label>
        <NativeSelect
          id="billing-status"
          className="w-40"
          value={params.get("status") ?? ""}
          onChange={(e) => update({ status: e.target.value || null })}
        >
          <option value="">{t("allStatuses")}</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {dates ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="billing-from" className="text-muted-foreground text-xs">
              {t("from", { field: dates.label })}
            </Label>
            <Input
              id="billing-from"
              type="date"
              className="w-40"
              value={params.get("from") ?? ""}
              onChange={(e) => update({ from: e.target.value || null })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="billing-to" className="text-muted-foreground text-xs">
              {t("to", { field: dates.label })}
            </Label>
            <Input
              id="billing-to"
              type="date"
              className="w-40"
              value={params.get("to") ?? ""}
              onChange={(e) => update({ to: e.target.value || null })}
            />
          </div>
        </>
      ) : null}
      {customer ? (
        <span className="bg-muted inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm">
          {t("customer", { name: customer.name })}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeCustomer", { name: customer.name })}
            onClick={() => update({ customer: null })}
          >
            <X />
          </Button>
        </span>
      ) : null}
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            clearing.current = q !== "";
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          {t("clear")}
        </Button>
      ) : null}
    </div>
  );
}
