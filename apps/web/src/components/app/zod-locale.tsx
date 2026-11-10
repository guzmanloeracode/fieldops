"use client";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { z } from "zod";
import { isLocale } from "@/i18n/locales";
import { zodErrorMap } from "@/i18n/zod";

/**
 * Form validation messages in the reader's language (SET-05). Zod's configuration is global, so it is set in the
 * browser only (an effect), never during server rendering where requests in other languages share the process.
 */
export function ZodLocale() {
  const locale = useLocale();
  const t = useTranslations("common.validation");
  useEffect(() => {
    z.config({ localeError: zodErrorMap(t, isLocale(locale) ? locale : "en") });
  }, [t, locale]);
  return null;
}
