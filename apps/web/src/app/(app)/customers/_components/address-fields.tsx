"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useTranslations } from "next-intl";
import { get, type UseFormReturn } from "react-hook-form";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countryOptions } from "@/lib/countries";

/** Address inputs bound to `${prefix}.line1` … `${prefix}.country`, matching the shared addressSchema. */
export function AddressFields({ form, prefix, idPrefix }: { form: UseFormReturn<any, any, any>; prefix: string; idPrefix: string }) {
  const t = useTranslations("customers.form");
  const err = (name: string) => (get(form.formState.errors, `${prefix}.${name}`) as { message?: string } | undefined)?.message;
  const field = (name: string, label: string, opts: { autoComplete?: string; className?: string; required?: boolean } = {}) => {
    const id = `${idPrefix}-${name}`;
    const message = err(name);
    return (
      <div className={`space-y-1.5 ${opts.className ?? ""}`}>
        <Label htmlFor={id}>
          {label}
          {opts.required ? <span aria-hidden className="text-destructive">*</span> : null}
        </Label>
        <Input
          id={id}
          autoComplete={opts.autoComplete}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? `${id}-error` : undefined}
          {...form.register(`${prefix}.${name}`)}
        />
        <FieldError id={`${id}-error`} message={message} />
      </div>
    );
  };
  const countryId = `${idPrefix}-country`;
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      {field("line1", t("line1"), { autoComplete: "address-line1", className: "sm:col-span-4", required: true })}
      {field("line2", t("line2"), { autoComplete: "address-line2", className: "sm:col-span-2" })}
      {field("city", t("city"), { autoComplete: "address-level2", className: "sm:col-span-2", required: true })}
      {field("region", t("region"), { autoComplete: "address-level1", className: "sm:col-span-2" })}
      {field("postal_code", t("postalCode"), { autoComplete: "postal-code", className: "sm:col-span-2" })}
      <div className="space-y-1.5 sm:col-span-3">
        <Label htmlFor={countryId}>{t("country")}</Label>
        <NativeSelect id={countryId} autoComplete="country" {...form.register(`${prefix}.country`)}>
          {countryOptions().map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <FieldError message={err("country")} />
      </div>
    </div>
  );
}
