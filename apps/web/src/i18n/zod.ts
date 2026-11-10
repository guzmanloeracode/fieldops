import { z } from "zod";
import type { Locale } from "./locales";

/** A translator for the `common.validation` namespace (next-intl, server or client). */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Plain-language messages for Zod's built-in checks, in the reader's language (SET-05). Messages written in a schema
 * still win; anything not covered here falls back to Zod's own locale.
 */
export function zodErrorMap(t: Translate, locale: Locale): z.core.$ZodErrorMap {
  const fallback = (locale === "id" ? z.locales.id() : z.locales.en()).localeError;
  return (issue) => {
    switch (issue.code) {
      case "invalid_type":
        if (issue.input === undefined || issue.input === null || issue.input === "") return t("required");
        if (issue.expected === "number") return t("number");
        break;
      case "too_small": {
        const min = Number(issue.minimum);
        if (issue.origin === "string") return min <= 1 ? t("required") : t("minLength", { min });
        if (issue.origin === "number")
          return issue.inclusive === false ? t("above", { min }) : t("min", { min });
        if (issue.origin === "array") return t("minItems", { min });
        break;
      }
      case "too_big": {
        const max = Number(issue.maximum);
        if (issue.origin === "string") return t("maxLength", { max });
        if (issue.origin === "number") return t("max", { max });
        if (issue.origin === "array") return t("maxItems", { max });
        break;
      }
      case "invalid_format":
        if (issue.format === "email") return t("email");
        if (issue.format === "url") return t("url");
        return t("format");
      case "invalid_value":
        return t("choose");
    }
    return fallback(issue);
  };
}
