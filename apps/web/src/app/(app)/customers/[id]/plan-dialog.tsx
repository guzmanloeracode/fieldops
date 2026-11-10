"use client";
import { recurrenceRules } from "@fieldops/core";
import {
  JOB_PRIORITIES,
  MAX_LEAD_DAYS,
  PLAN_PREVIEW_COUNT,
  RECURRENCE_UNITS,
  type JobPriority,
  type RecurrenceUnit,
} from "@fieldops/shared";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/recurrence";
import { createPlanAction, updatePlanAction } from "./plan-actions";

export interface PlanFormValues {
  title: string;
  description: string;
  site_id: string;
  equipment_id: string;
  service_type_id: string;
  priority: JobPriority;
  interval_unit: RecurrenceUnit;
  interval_count: string;
  starts_on: string;
  ends_on: string;
  window_start: string;
  window_minutes: string;
  lead_days: string;
  lead_member_id: string;
}

export interface PlanOptions {
  sites: { id: string; label: string; equipment: { id: string; label: string }[] }[];
  serviceTypes: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  /** The organization's local date, where the preview starts. */
  today: string;
}

const WINDOW_LENGTHS = [30, 60, 90, 120, 180, 240, 480];

/** Create or edit a maintenance plan, with a live preview of its next visit dates (JOB-13). */
export function PlanDialog({
  customerId,
  options,
  plan,
}: {
  customerId: string;
  options: PlanOptions;
  plan?: { id: string; values: PlanFormValues };
}) {
  const t = useTranslations("recurrences");
  const locale = useLocale();
  const tp = useTranslations("common.priority");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const initial: PlanFormValues = plan?.values ?? {
    title: "",
    description: "",
    site_id: options.sites[0]?.id ?? "",
    equipment_id: "",
    service_type_id: "",
    priority: "normal",
    interval_unit: "month",
    interval_count: "3",
    starts_on: options.today,
    ends_on: "",
    window_start: "09:00",
    window_minutes: "120",
    lead_days: "14",
    lead_member_id: "",
  };
  const [v, setV] = useState<PlanFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));
  const id = (field: string) => `${plan ? `plan-${plan.id}` : "new-plan"}-${field}`;
  const equipment = options.sites.find((s) => s.id === v.site_id)?.equipment ?? [];
  const count = Number(v.interval_count);

  const preview = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.starts_on) || !Number.isInteger(count) || count < 1) return [];
    try {
      return recurrenceRules.upcomingOccurrences(
        {
          unit: v.interval_unit,
          count,
          startsOn: v.starts_on,
          endsOn: /^\d{4}-\d{2}-\d{2}$/.test(v.ends_on) ? v.ends_on : null,
        },
        options.today,
        PLAN_PREVIEW_COUNT,
      );
    } catch {
      return [];
    }
  }, [v.interval_unit, count, v.starts_on, v.ends_on, options.today]);

  const payload = () => ({
    ...(plan ? {} : { customer_id: customerId }),
    title: v.title,
    description: v.description,
    site_id: v.site_id,
    equipment_id: v.equipment_id || null,
    service_type_id: v.service_type_id || null,
    priority: v.priority,
    interval_unit: v.interval_unit,
    interval_count: Number(v.interval_count),
    starts_on: v.starts_on,
    ends_on: v.ends_on || null,
    window_start: v.window_start || null,
    window_minutes: v.window_start ? Number(v.window_minutes) : null,
    lead_days: Number(v.lead_days),
    lead_member_id: v.lead_member_id || null,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = plan
        ? await updatePlanAction(customerId, plan.id, payload())
        : await createPlanAction(customerId, payload());
      if (!res.ok) {
        setErrors(Object.fromEntries((res.error.fields ?? []).map((f) => [f.path, f.message])));
        toast.error(res.error.message);
        return;
      }
      setErrors({});
      toast.success(plan ? t("form.updated") : t("form.created", { count: res.data.jobs }));
      setOpen(false);
      if (!plan) setV(initial);
      router.refresh();
    });
  };

  const field = (name: keyof PlanFormValues | "customer_id", label: string, control: React.ReactNode) => (
    <div className="space-y-1.5">
      <Label htmlFor={id(name)}>{label}</Label>
      {control}
      {errors[name] ? (
        <p id={id(`${name}-error`)} className="text-destructive text-xs">
          {errors[name]}
        </p>
      ) : null}
    </div>
  );
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true, "aria-describedby": id(`${name}-error`) } : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setV(initial);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        {plan ? (
          <Button variant="ghost" size="sm" aria-label={`${t("plans.edit")}: ${plan.values.title}`}>
            <Pencil />
            <span className="hidden sm:inline">{t("plans.edit")}</span>
          </Button>
        ) : (
          <Button variant="outline" size="sm" data-testid="plan-add">
            <Plus /> {t("plans.add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plan ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
          <DialogDescription>{t("form.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="plan-form">
          {field(
            "title",
            t("form.title"),
            <Input
              id={id("title")}
              value={v.title}
              placeholder={t("form.titlePlaceholder")}
              onChange={(e) => set("title", e.target.value)}
              required
              {...invalid("title")}
            />,
          )}
          {field(
            "description",
            t("form.notes"),
            <Textarea
              id={id("description")}
              rows={2}
              value={v.description}
              placeholder={t("form.notesPlaceholder")}
              onChange={(e) => set("description", e.target.value)}
            />,
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "site_id",
              t("form.site"),
              <NativeSelect
                id={id("site_id")}
                value={v.site_id}
                onChange={(e) => setV((p) => ({ ...p, site_id: e.target.value, equipment_id: "" }))}
                {...invalid("site_id")}
              >
                {options.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>,
            )}
            {field(
              "equipment_id",
              t("form.equipment"),
              <NativeSelect
                id={id("equipment_id")}
                value={v.equipment_id}
                onChange={(e) => set("equipment_id", e.target.value)}
                {...invalid("equipment_id")}
              >
                <option value="">{t("form.none")}</option>
                {equipment.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </NativeSelect>,
            )}
            {field(
              "service_type_id",
              t("form.serviceType"),
              <NativeSelect
                id={id("service_type_id")}
                value={v.service_type_id}
                onChange={(e) => set("service_type_id", e.target.value)}
              >
                <option value="">{t("form.none")}</option>
                {options.serviceTypes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>,
            )}
            {field(
              "priority",
              t("form.priority"),
              <NativeSelect
                id={id("priority")}
                value={v.priority}
                onChange={(e) => set("priority", e.target.value as JobPriority)}
              >
                {JOB_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {tp(p)}
                  </option>
                ))}
              </NativeSelect>,
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-2 gap-2">
              {field(
                "interval_count",
                t("form.count"),
                <Input
                  id={id("interval_count")}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={v.interval_count}
                  onChange={(e) => set("interval_count", e.target.value)}
                  {...invalid("interval_count")}
                />,
              )}
              {field(
                "interval_unit",
                t("form.unit"),
                <NativeSelect
                  id={id("interval_unit")}
                  value={v.interval_unit}
                  onChange={(e) => set("interval_unit", e.target.value as RecurrenceUnit)}
                >
                  {RECURRENCE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {t(`form.units.${u}`, { count: Number.isFinite(count) ? count : 1 })}
                    </option>
                  ))}
                </NativeSelect>,
              )}
            </div>
            {field(
              "lead_days",
              t("form.leadDays"),
              <Input
                id={id("lead_days")}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_LEAD_DAYS}
                value={v.lead_days}
                onChange={(e) => set("lead_days", e.target.value)}
                {...invalid("lead_days")}
              />,
            )}
            {field(
              "starts_on",
              t("form.startsOn"),
              <Input
                id={id("starts_on")}
                type="date"
                value={v.starts_on}
                onChange={(e) => set("starts_on", e.target.value)}
                {...invalid("starts_on")}
              />,
            )}
            {field(
              "ends_on",
              t("form.endsOn"),
              <Input
                id={id("ends_on")}
                type="date"
                value={v.ends_on}
                onChange={(e) => set("ends_on", e.target.value)}
                {...invalid("ends_on")}
              />,
            )}
            {field(
              "window_start",
              t("form.windowStart"),
              <Input
                id={id("window_start")}
                type="time"
                step={900}
                value={v.window_start}
                onChange={(e) => set("window_start", e.target.value)}
                {...invalid("window_start")}
              />,
            )}
            {field(
              "window_minutes",
              t("form.windowMinutes"),
              <NativeSelect
                id={id("window_minutes")}
                value={v.window_minutes}
                disabled={!v.window_start}
                onChange={(e) => set("window_minutes", e.target.value)}
                {...invalid("window_minutes")}
              >
                {WINDOW_LENGTHS.map((m) => (
                  <option key={m} value={String(m)}>
                    {m < 60 || m % 60 ? t("form.minutes", { count: m }) : t("form.hours", { count: m / 60 })}
                  </option>
                ))}
              </NativeSelect>,
            )}
          </div>

          {field(
            "lead_member_id",
            t("form.leadMember"),
            <>
              <NativeSelect
                id={id("lead_member_id")}
                value={v.lead_member_id}
                aria-describedby={id("lead_member_id-hint")}
                onChange={(e) => set("lead_member_id", e.target.value)}
              >
                <option value="">{t("form.none")}</option>
                {options.technicians.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
              <p id={id("lead_member_id-hint")} className="text-muted-foreground text-xs">
                {t("form.leadMemberHint")}
              </p>
            </>,
          )}

          <section aria-labelledby={id("preview")} className="bg-muted/50 rounded-md border p-3">
            <h3 id={id("preview")} className="text-sm font-medium">
              {t("form.preview")}
            </h3>
            {preview.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-sm">{t("form.previewNone")}</p>
            ) : (
              <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm" data-testid="plan-preview">
                {preview.map((d) => (
                  <li key={d} className="tabular-nums">
                    <time dateTime={d}>{formatDay(d, "long", locale)}</time>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-muted-foreground mt-2 text-xs">{t("form.previewHint")}</p>
          </section>

          <DialogFooter>
            <Button type="submit" disabled={pending} data-testid="plan-save">
              {pending ? <Loader2 className="animate-spin" /> : null} {t("form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
