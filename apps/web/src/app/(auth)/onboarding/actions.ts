"use server";
import { schema, withStore } from "@fieldops/db";
import { organizationCreateSchema } from "@fieldops/shared";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/locales";
import { zodErrorMap } from "@/i18n/zod";
import { auth } from "@/server/auth";
import { getSession } from "@/server/context";
import { db } from "@/server/db";

// Named in the owner's language (SET-05).
const STARTER_SERVICES = [
  { key: "inspection", defaultDurationMin: 60, price: { USD: 9_900, IDR: 15_000_000 } },
  { key: "repair", defaultDurationMin: 120, price: { USD: 18_900, IDR: 25_000_000 } },
  { key: "maintenance", defaultDurationMin: 90, price: { USD: 12_900, IDR: 8_500_000 } },
] as const;

export async function createOrganizationAction(
  input: unknown,
): Promise<{ ok: false; message: string; fields?: Record<string, string> }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const t = await getTranslations("auth");
  // Shared demo accounts can't create organizations: every visitor signs in as the same people.
  if (session.user.isDemo) return { ok: false, message: t("errors.demoDisabled") };
  const locale = await getLocale();
  const parsed = organizationCreateSchema.safeParse(input, {
    error: zodErrorMap(await getTranslations("common.validation"), isLocale(locale) ? locale : "en"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: t("errors.check"),
      fields: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
    };
  }
  const v = parsed.data;
  let orgId: string;
  try {
    const org = await auth.api.createOrganization({
      body: { name: v.name, slug: v.slug, timezone: v.timezone, currency: v.currency, country: v.country },
      headers: await headers(),
    });
    if (!org) return { ok: false, message: t("errors.orgFailed") };
    orgId = org.id;
  } catch (err) {
    const body = (err as { body?: { code?: string; message?: string } }).body;
    const taken = /slug/i.test(`${body?.code ?? ""} ${body?.message ?? ""}`);
    return {
      ok: false,
      message: taken ? t("errors.slugTaken") : t("errors.orgFailed"),
      fields: taken ? { slug: t("errors.slugTakenField") } : undefined,
    };
  }
  // A few starter service types so the first job can be created right away.
  await withStore(
    db,
    orgId,
    async (_store, tx) => {
      await tx.insert(schema.serviceType).values(
        STARTER_SERVICES.map((s) => ({
          organizationId: orgId,
          name: t(`onboarding.starter.${s.key}`),
          defaultDurationMin: s.defaultDurationMin,
          defaultPriceMinor: s.price[v.currency],
          currency: v.currency,
        })),
      );
    },
    { userId: session.user.id },
  );
  redirect("/dashboard");
}
