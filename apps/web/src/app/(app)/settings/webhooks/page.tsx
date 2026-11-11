import { getTranslations } from "next-intl/server";

/** Placeholder until the 0.5 slice replaces it. */
export default async function Page() {
  const t = await getTranslations("webhooks");
  return <h2 className="text-lg font-semibold">{t("title")}</h2>;
}
