"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { parseMajor, toMajor } from "@fieldops/core";
import { serviceTypeInputSchema, type ChecklistTemplateItem, type Currency } from "@fieldops/shared";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm, type Path } from "react-hook-form";
import { ChecklistTemplateEditor, SkillsEditor } from "./template-editor";
import { toast } from "sonner";
import { z } from "zod";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { percent } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createServiceTypeAction, updateServiceTypeAction } from "./actions";

const formSchema = (t: (key: string) => string) =>
  serviceTypeInputSchema.omit({ default_price_minor: true, color: true }).extend({
    price: z.string().trim().min(1, t("errors.price")).max(20),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  });
export type FormInput = z.input<ReturnType<typeof formSchema>>;
export type FormOutput = z.output<ReturnType<typeof formSchema>>;

export interface ServiceTypeValues {
  id: string;
  name: string;
  description: string | null;
  defaultDurationMin: number;
  defaultPriceMinor: number;
  color: string | null;
  active: boolean;
  currency: Currency;
  requiredSkills: string[];
  checklistTemplate: ChecklistTemplateItem[];
  /** Null uses the organization's default rate (FIN-01). */
  taxRateBps: number | null;
}

export function ServiceTypeDialog({
  currency,
  taxRates,
  serviceType,
}: {
  currency: Currency;
  taxRates: { name: string; rate_bps: number; default: boolean }[];
  serviceType?: ServiceTypeValues;
}) {
  const t = useTranslations("settings.serviceTypes");
  const tb = useTranslations("billing.serviceType");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const priceCurrency = serviceType?.currency ?? currency;
  const defaults: FormInput = serviceType
    ? {
        name: serviceType.name,
        description: serviceType.description ?? "",
        default_duration_min: serviceType.defaultDurationMin,
        price: String(toMajor(serviceType.defaultPriceMinor, serviceType.currency)),
        color: serviceType.color ?? "#0369a1",
        active: serviceType.active,
        required_skills: serviceType.requiredSkills,
        checklist_template: serviceType.checklistTemplate.map((i) => ({ ...i, unit: i.unit ?? "" })),
        tax_rate_bps: serviceType.taxRateBps,
      }
    : {
        name: "",
        description: "",
        default_duration_min: 60,
        price: "0",
        color: "#0369a1",
        active: true,
        required_skills: [],
        checklist_template: [],
        tax_rate_bps: null,
      };
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema(t)),
    defaultValues: defaults,
  });
  const errors = form.formState.errors;
  const idp = serviceType ? `st-${serviceType.id}` : "st-new";

  const onSubmit = form.handleSubmit((values) => {
    const minor = parseMajor(values.price, priceCurrency);
    if (minor === null || minor < 0) {
      form.setError("price", { message: t("priceInvalid") });
      return;
    }
    const { price: _price, ...rest } = values;
    const payload = { ...rest, default_price_minor: minor };
    startTransition(async () => {
      const res = serviceType
        ? await updateServiceTypeAction(serviceType.id, payload)
        : await createServiceTypeAction(payload);
      if (!res.ok) {
        for (const f of res.error.fields ?? []) {
          form.setError((f.path === "default_price_minor" ? "price" : f.path) as Path<FormInput>, {
            message: f.message,
          });
        }
        toast.error(res.error.message);
        return;
      }
      toast.success(serviceType ? t("updated") : t("created"));
      setOpen(false);
      if (!serviceType) form.reset(defaults);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {serviceType ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("editLabel", { name: serviceType.name })}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{serviceType ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-name`}>{t("name")}</Label>
            <Input id={`${idp}-name`} aria-invalid={Boolean(errors.name)} {...form.register("name")} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-desc`}>{t("descriptionField")}</Label>
            <Textarea id={`${idp}-desc`} rows={2} {...form.register("description")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idp}-duration`}>{t("duration")}</Label>
              <Input
                id={`${idp}-duration`}
                type="number"
                min={5}
                max={1440}
                step={5}
                aria-invalid={Boolean(errors.default_duration_min)}
                {...form.register("default_duration_min", { valueAsNumber: true })}
              />
              <FieldError message={errors.default_duration_min?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idp}-price`}>{t("price", { currency: priceCurrency })}</Label>
              <Input
                id={`${idp}-price`}
                inputMode="decimal"
                aria-invalid={Boolean(errors.price)}
                {...form.register("price")}
              />
              <FieldError message={errors.price?.message} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-tax`}>{tb("tax")}</Label>
            <NativeSelect
              id={`${idp}-tax`}
              className="sm:max-w-72"
              value={form.watch("tax_rate_bps") == null ? "" : String(form.watch("tax_rate_bps"))}
              aria-describedby={`${idp}-tax-hint`}
              onChange={(e) =>
                form.setValue("tax_rate_bps", e.target.value === "" ? null : Number(e.target.value), {
                  shouldDirty: true,
                })
              }
            >
              <option value="">{tb("defaultRate")}</option>
              {taxRates.map((r) => (
                <option key={`${r.name}-${r.rate_bps}`} value={r.rate_bps}>
                  {r.name} ({percent(r.rate_bps, locale)})
                </option>
              ))}
            </NativeSelect>
            <p id={`${idp}-tax-hint`} className="text-muted-foreground text-xs">
              {tb("taxHint")}
            </p>
            <FieldError message={errors.tax_rate_bps?.message} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Label htmlFor={`${idp}-color`}>{t("color")}</Label>
              <input
                id={`${idp}-color`}
                type="color"
                className="border-input h-9 w-14 cursor-pointer rounded-md border bg-transparent p-1"
                value={(form.watch("color") ?? "#0369a1").toLowerCase()}
                onChange={(e) => form.setValue("color", e.target.value, { shouldDirty: true })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`${idp}-active`}
                checked={Boolean(form.watch("active"))}
                onCheckedChange={(v) => form.setValue("active", v, { shouldDirty: true })}
                aria-describedby={`${idp}-active-hint`}
              />
              <Label htmlFor={`${idp}-active`}>{t("active")}</Label>
            </div>
          </div>
          <p id={`${idp}-active-hint`} className="text-muted-foreground text-xs">
            {t("activeHint")}
          </p>
          <SkillsEditor
            idPrefix={idp}
            value={form.watch("required_skills") ?? []}
            onChange={(v) => form.setValue("required_skills", v, { shouldDirty: true })}
          />
          <ChecklistTemplateEditor idPrefix={idp} form={form} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ActiveSwitch({ id, name, active }: { id: string; name: string; active: boolean }) {
  const t = useTranslations("settings.serviceTypes");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={`active-${id}`}
        checked={active}
        disabled={pending}
        aria-label={`${t("active")}: ${name}`}
        onCheckedChange={(v) =>
          startTransition(async () => {
            const res = await updateServiceTypeAction(id, { active: v });
            if (!res.ok) toast.error(res.error.message);
            router.refresh();
          })
        }
      />
      <span className="text-xs">{active ? t("statusActive") : t("statusInactive")}</span>
    </div>
  );
}
