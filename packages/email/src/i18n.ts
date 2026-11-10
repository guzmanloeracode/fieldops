// Emails go out in the recipient's language (SET-05): staff in their own, customers in theirs or their business's.
// Each template keeps its copy in a dictionary per language next to it; this package doesn't use next-intl.

export const EMAIL_LOCALES = ["en", "id"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/** Unknown or missing locales read English. */
export function emailLocale(locale: string | null | undefined): EmailLocale {
  return (EMAIL_LOCALES as readonly string[]).includes(locale ?? "") ? (locale as EmailLocale) : "en";
}

/** BCP 47 tags for dates in emails. */
export const INTL_LOCALE: Record<EmailLocale, string> = { en: "en-US", id: "id-ID" };

/** A dictionary with one entry per language. */
export type Dictionary<T> = Record<EmailLocale, T>;

/** Role names as they read in an invitation ("as a dispatcher"). */
export const ROLE_NAMES: Dictionary<Record<string, string>> = {
  en: { owner: "owner", admin: "admin", dispatcher: "dispatcher", technician: "technician" },
  id: { owner: "pemilik", admin: "admin", dispatcher: "dispatcher", technician: "teknisi" },
};
