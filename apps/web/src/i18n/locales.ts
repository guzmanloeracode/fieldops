import { DEFAULT_LOCALE, LOCALES, type Locale } from "@fieldops/shared";

// Locale helpers shared by the server, the proxy and client components (SET-05). No server-only imports here.

export { DEFAULT_LOCALE, LOCALES, type Locale };

/** The visitor's explicit language choice: signed-out pages, the customer portal and demo accounts. */
export const LOCALE_COOKIE = "fieldops_locale";

/** One year; the choice is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export { PATH_HEADER } from "./path-header";

/** Each language's name in its own language, for language pickers. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", id: "Bahasa Indonesia" };

/** BCP 47 tags for `Intl` and money: the UI language decides how numbers and dates read. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", id: "id-ID" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported language from an Accept-Language header (RFC 9110 §12.5.4): the highest weight wins,
 * ties keep header order, and a regional tag such as `id-ID` matches its language. Null when nothing matches.
 */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0] ?? "", weight, index };
    })
    .filter((r) => r.lang && Number.isFinite(r.weight) && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.map((r) => (r.lang === "in" ? "id" : r.lang)).find(isLocale) ?? null;
}

type Messages = { [key: string]: string | Messages };

/**
 * `base` with the messages of `override` laid over it, recursively. A partly translated namespace keeps the
 * English text for its missing keys instead of showing the raw key; keys English doesn't have are dropped.
 */
export function mergeMessages<T extends Messages>(base: T, override: Messages): T {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (typeof value === "string") {
      if (typeof current === "string") out[key] = value;
    } else if (current !== undefined && typeof current !== "string") {
      out[key] = mergeMessages(current, value);
    }
  }
  return out as T;
}
