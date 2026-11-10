"use server";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/i18n/locales";
import { getSession } from "@/server/context";
import { saveUserLocale, setLocaleCookie } from "@/server/locale";

/**
 * Switches the language (SET-05). The browser always remembers it (signed-out pages, the customer portal, demo
 * accounts). From the app's user menu (`account`), the signed-in user's account keeps it too, for every device and
 * for their emails.
 */
export async function changeLocaleAction(
  locale: unknown,
  scope: "account" | "browser",
): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  await setLocaleCookie(locale);
  if (scope === "account") {
    const session = await getSession();
    if (session) await saveUserLocale(session.user.id, locale);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
