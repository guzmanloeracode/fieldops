"use client";
import { PRIORITY_LABELS, STATUS_LABELS } from "@fieldops/core";
import { JOB_PRIORITIES, JOB_STATUSES } from "@fieldops/shared";
import { ChevronDown, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { id: string; name: string };

/** Filters for the jobs table. Every filter lives in the URL so views can be shared and bookmarked (JOB-03). */
export function JobFilters({
  members,
  serviceTypes,
  customer,
  showTechnician,
}: {
  members: Option[];
  serviceTypes: Option[];
  customer: Option | null;
  showTechnician: boolean;
}) {
  const t = useTranslations("jobs");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

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
    if (q === (params.get("q") ?? "")) return;
    const id = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const multi = (key: "status" | "priority") => (params.get(key) ?? "").split(",").filter(Boolean);
  const toggle = (key: "status" | "priority", value: string) => {
    const current = new Set(multi(key));
    if (current.has(value)) current.delete(value);
    else current.add(value);
    update({ [key]: [...current].join(",") || null });
  };

  const activeCount = ["status", "priority", "technician", "service_type", "customer", "from", "to", "q"].filter((k) => params.get(k)).length;

  return (
    <div className="mb-4 space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("search")}
            className="pl-8"
          />
        </div>
        <MultiSelect
          label={t("col.status")}
          options={JOB_STATUSES.map((s) => ({ id: s, name: STATUS_LABELS[s] }))}
          selected={multi("status")}
          onToggle={(v) => toggle("status", v)}
        />
        <MultiSelect
          label={t("col.priority")}
          options={JOB_PRIORITIES.map((p) => ({ id: p, name: PRIORITY_LABELS[p] }))}
          selected={multi("priority")}
          onToggle={(v) => toggle("priority", v)}
        />
        {showTechnician ? (
          <Select value={params.get("technician") ?? "all"} onValueChange={(v) => update({ technician: v === "all" ? null : v })}>
            <SelectTrigger className="w-44" aria-label={t("col.technician")}>
              <SelectValue placeholder={t("col.technician")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTechnicians")}</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={params.get("service_type") ?? "all"} onValueChange={(v) => update({ service_type: v === "all" ? null : v })}>
          <SelectTrigger className="w-44" aria-label={t("col.serviceType")}>
            <SelectValue placeholder={t("col.serviceType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allServiceTypes")}</SelectItem>
            {serviceTypes.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="from" className="sr-only">
            {t("from")}
          </Label>
          <Input id="from" type="date" className="w-38" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value || null })} />
          <span className="text-muted-foreground text-sm">–</span>
          <Label htmlFor="to" className="sr-only">
            {t("to")}
          </Label>
          <Input id="to" type="date" className="w-38" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value || null })} />
        </div>
        {activeCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <X /> {t("clearFilters")}
          </Button>
        ) : null}
      </div>
      {customer ? (
        <div className="flex">
          <span className="bg-secondary inline-flex items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-xs">
            {t("customerChip", { name: customer.name })}
            <button type="button" onClick={() => update({ customer: null })} className="hover:bg-background rounded-full p-0.5" aria-label={t("removeCustomerFilter")}>
              <X className="size-3" />
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function MultiSelect({ label, options, selected, onToggle }: { label: string; options: Option[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-between gap-2 font-normal">
          {label}
          {selected.length ? <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs">{selected.length}</span> : null}
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start">
        <fieldset>
          <legend className="sr-only">{label}</legend>
          {options.map((o) => (
            <label key={o.id} className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
              <Checkbox checked={selected.includes(o.id)} onCheckedChange={() => onToggle(o.id)} />
              {o.name}
            </label>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
