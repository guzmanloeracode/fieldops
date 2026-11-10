"use client";
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useTransition } from "react";
import { changeLocaleAction } from "@/app/locale-actions";
import { LOCALE_NAMES, LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * The language picker of signed-out pages and the customer portal (SET-05). The choice is kept in this browser;
 * signed-in staff change theirs in the user menu.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("common.language");
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  return (
    <div className={cn("text-muted-foreground inline-flex items-center gap-1.5 text-sm", className)}>
      <Languages className="size-4 shrink-0" aria-hidden />
      <label htmlFor={id} className="sr-only">
        {t("label")}
      </label>
      <select
        id={id}
        data-testid="language-switcher"
        value={locale}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            await changeLocaleAction(next, "browser");
            router.refresh();
          });
        }}
        className="hover:text-foreground focus-visible:ring-ring/50 cursor-pointer rounded-md bg-transparent py-1 pr-1 text-sm outline-none focus-visible:ring-[3px]"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
