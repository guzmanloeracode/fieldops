"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { CURRENCIES, organizationUpdateSchema, type Address, type Currency } from "@fieldops/shared";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countryOptions } from "@/lib/countries";
import { AddressFields } from "../../customers/_components/address-fields";
import { updateOrganizationAction } from "./actions";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const formSchema = organizationUpdateSchema.omit({ business_hours: true, tax_rates: true }).extend({
  hours: z
    .array(
      z
        .object({ enabled: z.boolean(), open: hhmm, close: hhmm })
        .refine((h) => !h.enabled || h.close > h.open, {
          message: "Closing time must be after opening time",
          path: ["close"],
        }),
    )
    .length(7),
  taxes: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(60),
        rate: z
          .string()
          .trim()
          .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage like 8.25")
          .refine((v) => Number(v) <= 100, "Can't be more than 100%"),
        default: z.boolean(),
      }),
    )
    .max(10),
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export interface OrganizationFormValues {
  name: string;
  slug: string;
  timezone: string;
  currency: Currency;
  country: string;
  brandColor: string | null;
  address: Address | null;
  businessHours: { day: number; open: string; close: string }[];
  taxRates: { name: string; rate_bps: number; default: boolean }[];
}

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export function OrganizationForm({ org, timeZones }: { org: OrganizationFormValues; timeZones: string[] }) {
  const t = useTranslations("settings.organization");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hasAddress, setHasAddress] = useState(Boolean(org.address));
  const zones = timeZones.includes(org.timezone) ? timeZones : [org.timezone, ...timeZones];

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    shouldUnregister: false,
    defaultValues: {
      name: org.name,
      timezone: org.timezone,
      currency: org.currency,
      country: org.country,
      brand_color: org.brandColor ?? "#0369a1",
      address: org.address
        ? {
            ...org.address,
            line2: org.address.line2 ?? "",
            region: org.address.region ?? "",
            postal_code: org.address.postal_code ?? "",
          }
        : { line1: "", line2: "", city: "", region: "", postal_code: "", country: org.country },
      hours: Array.from({ length: 7 }, (_, day) => {
        const h = org.businessHours.find((b) => b.day === day);
        return { enabled: Boolean(h), open: h?.open ?? "08:00", close: h?.close ?? "17:00" };
      }),
      taxes: org.taxRates.map((r) => ({ name: r.name, rate: String(r.rate_bps / 100), default: r.default })),
    },
  });
  const taxes = useFieldArray({ control: form.control, name: "taxes" });
  const errors = form.formState.errors;
  const hours = form.watch("hours");

  const onSubmit = form.handleSubmit((values) => {
    const { hours: h, taxes: tx, ...rest } = values;
    const payload = {
      ...rest,
      address: hasAddress ? rest.address : null,
      business_hours: h.flatMap((row, day) =>
        row.enabled ? [{ day, open: row.open, close: row.close }] : [],
      ),
      tax_rates: tx.map((r) => ({
        name: r.name,
        rate_bps: Math.round(Number(r.rate) * 100),
        default: r.default,
      })),
    };
    startTransition(async () => {
      const res = await updateOrganizationAction(payload);
      if (!res.ok) {
        for (const f of res.error.fields ?? [])
          form.setError(f.path as Path<FormInput>, { message: f.message });
        toast.error(res.error.message);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("profile")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">{t("name")}</Label>
              <Input id="org-name" aria-invalid={Boolean(errors.name)} {...form.register("name")} />
              <FieldError message={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">{t("slug")}</Label>
              <Input id="org-slug" value={org.slug} readOnly disabled aria-describedby="org-slug-hint" />
              <p id="org-slug-hint" className="text-muted-foreground text-xs">
                {t("slugHint")}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-color">{t("brandColor")}</Label>
            <div className="flex items-center gap-3">
              <input
                id="org-color"
                type="color"
                className="border-input h-9 w-14 cursor-pointer rounded-md border bg-transparent p-1"
                aria-describedby="org-color-hint"
                value={(form.watch("brand_color") ?? "#0369a1").toLowerCase()}
                onChange={(e) =>
                  form.setValue("brand_color", e.target.value, { shouldDirty: true, shouldValidate: true })
                }
              />
              <span className="font-mono text-sm">{form.watch("brand_color")}</span>
            </div>
            <p id="org-color-hint" className="text-muted-foreground text-xs">
              {t("brandColorHint")}
            </p>
            <FieldError message={errors.brand_color?.message} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("locale")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="org-tz">{t("timezone")}</Label>
            <NativeSelect id="org-tz" aria-describedby="org-tz-hint" {...form.register("timezone")}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </NativeSelect>
            <p id="org-tz-hint" className="text-muted-foreground text-xs">
              {t("timezoneHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-currency">{t("currency")}</Label>
            <NativeSelect id="org-currency" {...form.register("currency")}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="org-country">{t("country")}</Label>
            <NativeSelect id="org-country" {...form.register("country")}>
              {countryOptions().map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("address")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="org-has-address"
              checked={hasAddress}
              onCheckedChange={(v) => {
                setHasAddress(v === true);
                if (v !== true) form.unregister("address", { keepDefaultValue: true });
              }}
            />
            <Label htmlFor="org-has-address" className="font-normal">
              {t("hasAddress")}
            </Label>
          </div>
          {hasAddress ? <AddressFields form={form} prefix="address" idPrefix="org-address" /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("hours")}</CardTitle>
          <CardDescription>{t("hoursHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {DAYS.map((day) => {
              const enabled = hours?.[day]?.enabled;
              const dayLabel = t(`days.${day}`);
              return (
                <li
                  key={day}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 sm:grid-cols-[10rem_1fr]"
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`hours-${day}`}
                      checked={Boolean(enabled)}
                      onCheckedChange={(v) =>
                        form.setValue(`hours.${day}.enabled`, v === true, { shouldDirty: true })
                      }
                    />
                    <Label htmlFor={`hours-${day}`} className="font-normal">
                      {dayLabel}
                    </Label>
                  </div>
                  {enabled ? (
                    <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
                      <Label htmlFor={`hours-${day}-open`} className="sr-only">
                        {`${dayLabel}: ${t("opens")}`}
                      </Label>
                      <Input
                        id={`hours-${day}-open`}
                        type="time"
                        className="w-32"
                        {...form.register(`hours.${day}.open`)}
                      />
                      <span aria-hidden>–</span>
                      <Label htmlFor={`hours-${day}-close`} className="sr-only">
                        {`${dayLabel}: ${t("closes")}`}
                      </Label>
                      <Input
                        id={`hours-${day}-close`}
                        type="time"
                        className="w-32"
                        {...form.register(`hours.${day}.close`)}
                      />
                      <FieldError
                        message={errors.hours?.[day]?.close?.message ?? errors.hours?.[day]?.open?.message}
                      />
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm sm:col-span-1">{t("closed")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("taxRates")}</CardTitle>
          <CardDescription>{t("taxRatesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {taxes.fields.length === 0 ? <p className="text-muted-foreground text-sm">{t("noTax")}</p> : null}
          {taxes.fields.map((field, i) => (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_6rem_auto] items-end gap-2 sm:grid-cols-[1fr_8rem_auto_auto]"
            >
              <div className="space-y-1.5">
                <Label htmlFor={`tax-${i}-name`}>{t("taxName")}</Label>
                <Input
                  id={`tax-${i}-name`}
                  aria-invalid={Boolean(errors.taxes?.[i]?.name)}
                  {...form.register(`taxes.${i}.name`)}
                />
                <FieldError message={errors.taxes?.[i]?.name?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`tax-${i}-rate`}>{t("taxRate")}</Label>
                <Input
                  id={`tax-${i}-rate`}
                  inputMode="decimal"
                  aria-invalid={Boolean(errors.taxes?.[i]?.rate)}
                  {...form.register(`taxes.${i}.rate`)}
                />
                <FieldError message={errors.taxes?.[i]?.rate?.message} />
              </div>
              <div className="flex h-9 items-center gap-2">
                <Checkbox
                  id={`tax-${i}-default`}
                  checked={Boolean(form.watch(`taxes.${i}.default`))}
                  onCheckedChange={(v) =>
                    form
                      .getValues("taxes")
                      .forEach((_, j) =>
                        form.setValue(`taxes.${j}.default`, v === true && j === i, { shouldDirty: true }),
                      )
                  }
                />
                <Label htmlFor={`tax-${i}-default`} className="font-normal">
                  {t("taxDefault")}
                </Label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("removeTax", { index: i + 1 })}
                onClick={() => taxes.remove(i)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {taxes.fields.length < 10 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => taxes.append({ name: "", rate: "0", default: taxes.fields.length === 0 })}
            >
              <Plus /> {t("addTax")}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} {t("save")}
        </Button>
      </div>
    </form>
  );
}
