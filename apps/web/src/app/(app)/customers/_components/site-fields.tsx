"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useTranslations } from "next-intl";
import { get, type UseFormReturn } from "react-hook-form";
import { FieldError } from "@/components/app/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "./address-fields";

const toNumberOrNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

/** Fields of the shared siteCreateSchema, bound under `prefix` (empty prefix = root of the form). */
export function SiteFields({ form, prefix, idPrefix }: { form: UseFormReturn<any, any, any>; prefix: string; idPrefix: string }) {
  const t = useTranslations("customers.form");
  const p = (name: string) => (prefix ? `${prefix}.${name}` : name);
  const err = (name: string) => (get(form.formState.errors, p(name)) as { message?: string } | undefined)?.message;
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-label`}>
          {t("siteLabel")}
          <span aria-hidden className="text-destructive">*</span>
        </Label>
        <Input id={`${idPrefix}-label`} placeholder={t("siteLabelPlaceholder")} aria-invalid={Boolean(err("label"))} {...form.register(p("label"))} />
        <FieldError message={err("label")} />
      </div>
      <AddressFields form={form} prefix={p("address")} idPrefix={`${idPrefix}-address`} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="text-muted-foreground mb-2 text-xs">{t("coordinatesHint")}</legend>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-lat`}>{t("latitude")}</Label>
          <Input id={`${idPrefix}-lat`} type="number" step="any" inputMode="decimal" {...form.register(p("latitude"), { setValueAs: toNumberOrNull })} />
          <FieldError message={err("latitude")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-lng`}>{t("longitude")}</Label>
          <Input id={`${idPrefix}-lng`} type="number" step="any" inputMode="decimal" {...form.register(p("longitude"), { setValueAs: toNumberOrNull })} />
          <FieldError message={err("longitude")} />
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-access`}>{t("accessNotes")}</Label>
        <Textarea id={`${idPrefix}-access`} rows={2} placeholder={t("accessNotesPlaceholder")} {...form.register(p("access_notes"))} />
        <FieldError message={err("access_notes")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-onsite-name`}>{t("onsiteContactName")}</Label>
          <Input id={`${idPrefix}-onsite-name`} {...form.register(p("onsite_contact_name"))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-onsite-phone`}>{t("onsiteContactPhone")}</Label>
          <Input id={`${idPrefix}-onsite-phone`} type="tel" {...form.register(p("onsite_contact_phone"))} />
        </div>
      </div>
    </div>
  );
}
