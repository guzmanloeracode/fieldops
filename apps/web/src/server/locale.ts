import "server-only";
import type { Store } from "@fieldops/core";
import { schema } from "@fieldops/db";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { env } from "@/env";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  negotiateLocale,
  PATH_HEADER,
  type Locale,
} from "@/i18n/locales";
import { getSession } from "./context";
import { db } from "./db";
import { getPortalActor, getPortalOrg, withPortalStore } from "./portal/session";

// Which language a request is shown in (SET-05):
// - the app: the signed-in user's `user.locale` (demo accounts are shared, so their visitors' cookie wins);
// - the customer portal: the visitor's choice (cookie), else the signed-in contact's customer, else the
//   organization's customer language;
// - signed-out pages: the cookie, else Accept-Language, else English.

/** The user's saved language and whether the account is a shared demo account. */
export const getUserLocale = cache(
  async (userId: string): Promise<{ locale: Locale; isDemo: boolean } | null> => {
    const [u] = await db
      .select({ locale: schema.user.locale, isDemo: schema.user.isDemo })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    return u ? { locale: isLocale(u.locale) ? u.locale : DEFAULT_LOCALE, isDemo: u.isDemo } : null;
  },
);

/** The organization's language for customers (`settings.locale`). */
export async function organizationLocale(organizationId: string): Promise<Locale> {
  const [o] = await db
    .select({ settings: schema.organization.settings })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  const locale = (o?.settings as { locale?: unknown } | null)?.locale;
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** The language of emails and documents for a customer: their own, else the organization's (SET-05). */
export async function customerLocale(store: Store, customerId: string | null | undefined): Promise<Locale> {
  const own = customerId ? await store.customers.get(customerId) : null;
  if (isLocale(own?.locale)) return own.locale;
  return (await store.organization.get()).settings.locale;
}

/** The portal's language before the visitor chooses one: their customer's, else the organization's. */
export const getPortalLocale = cache(async (slug: string): Promise<Locale> => {
  const org = await getPortalOrg(slug);
  if (!org) return DEFAULT_LOCALE;
  const actor = await getPortalActor(slug);
  if (!actor) return organizationLocale(org.id);
  return withPortalStore(org, (store) => customerLocale(store, actor.customerId));
});

async function chosenLocale(): Promise<Locale | null> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : null;
}

/** The language of the current request. */
export const resolveLocale = cache(async (): Promise<Locale> => {
  const h = await headers();
  const chosen = await chosenLocale();
  const portal = /^\/portal\/([a-z0-9-]{1,64})(?:\/|$)/.exec(h.get(PATH_HEADER) ?? "");
  if (portal) return chosen ?? (await getPortalLocale(portal[1]!));
  const session = await getSession().catch(() => null);
  if (session) {
    const user = await getUserLocale(session.user.id);
    if (user) return user.isDemo && chosen ? chosen : user.locale;
  }
  return chosen ?? negotiateLocale(h.get("accept-language")) ?? DEFAULT_LOCALE;
});

/** Remembers the visitor's choice in this browser. */
export async function setLocaleCookie(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https"),
    maxAge: LOCALE_COOKIE_MAX_AGE,
  });
}

/** Saves the signed-in user's language. Demo accounts are shared, so they keep theirs and use the cookie. */
export async function saveUserLocale(userId: string, locale: Locale): Promise<void> {
  const user = await getUserLocale(userId);
  if (!user || user.isDemo) return;
  await db.update(schema.user).set({ locale, updatedAt: new Date() }).where(eq(schema.user.id, userId));
}
