"use client";
import type { Locale } from "@fieldops/shared";
import { useTranslations } from "next-intl";
import type { UseFormRegisterReturn } from "react-hook-form";
import { NativeSelect } from "@/components/app/native-select";
import { Label } from "@/components/ui/label";
import { LOCALE_NAMES, LOCALES } from "@/i18n/locales";

/** Empty select value → null: the customer follows the organization's language. */
export const localeValue = (v: unknown) => (v === "" || v === null || v === undefined ? null : v);

/** The customer's language for portal pages, emails and documents (SET-05); empty follows the organization. */
export function LocaleField({
  id,
  orgLocale,
  registration,
}: {
  id: string;
  orgLocale: Locale;
  registration: UseFormRegisterReturn;
}) {
  const t = useTranslations("customers.form");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("locale")}</Label>
      <NativeSelect id={id} aria-describedby={`${id}-hint`} {...registration}>
        <option value="">{t("localeDefault", { language: LOCALE_NAMES[orgLocale] })}</option>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </NativeSelect>
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {t("localeHint")}
      </p>
    </div>
  );
}
