"use client";
import { DASHBOARD_RANGES, type DashboardRange } from "@fieldops/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { id: string; name: string };

/** Period presets and filters for the overview (DSH-03). Everything lives in the URL. */
export function RangeFilters({
  range,
  from,
  to,
  technician,
  serviceType,
  technicians,
  serviceTypes,
}: {
  range: DashboardRange;
  from: string;
  to: string;
  technician: string | null;
  serviceType: string | null;
  technicians: Option[];
  serviceTypes: Option[];
}) {
  const t = useTranslations("dashboard.filters");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [showCustom, setShowCustom] = useState(range === "custom");

  const update = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.set("tab", "overview");
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending}>
      <div className="space-y-1">
        <Label htmlFor="dash-range" className="text-muted-foreground text-xs">
          {t("range")}
        </Label>
        <Select
          value={showCustom ? "custom" : range}
          onValueChange={(v) => {
            if (v === "custom") {
              setShowCustom(true);
              return;
            }
            setShowCustom(false);
            update({ range: v, from: null, to: null });
          }}
        >
          <SelectTrigger id="dash-range" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DASHBOARD_RANGES.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`ranges.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showCustom ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ range: "custom", from: customFrom, to: customTo });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="dash-from" className="text-muted-foreground text-xs">
              {t("from")}
            </Label>
            <Input
              id="dash-from"
              type="date"
              className="w-38"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dash-to" className="text-muted-foreground text-xs">
              {t("to")}
            </Label>
            <Input
              id="dash-to"
              type="date"
              className="w-38"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              required
            />
          </div>
          <Button type="submit" variant="secondary">
            {t("apply")}
          </Button>
        </form>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="dash-tech" className="text-muted-foreground text-xs">
          {t("technician")}
        </Label>
        <Select
          value={technician ?? "all"}
          onValueChange={(v) => update({ technician: v === "all" ? null : v })}
        >
          <SelectTrigger id="dash-tech" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allTechnicians")}</SelectItem>
            {technicians.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="dash-type" className="text-muted-foreground text-xs">
          {t("serviceType")}
        </Label>
        <Select
          value={serviceType ?? "all"}
          onValueChange={(v) => update({ service_type: v === "all" ? null : v })}
        >
          <SelectTrigger id="dash-type" className="w-44">
            <SelectValue />
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
      </div>
      {range !== "30d" || technician || serviceType ? (
        <Button
          variant="ghost"
          onClick={() => update({ range: null, from: null, to: null, technician: null, service_type: null })}
        >
          {t("reset")}
        </Button>
      ) : null}
    </div>
  );
}
