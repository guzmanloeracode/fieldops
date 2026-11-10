"use client";
import { Building2, Check, Languages, LogOut, Monitor, Moon, Plus, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useTransition } from "react";
import { toast } from "sonner";
import { switchOrganizationAction } from "@/app/(app)/org-actions";
import { changeLocaleAction } from "@/app/locale-actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALE_NAMES, LOCALES, isLocale } from "@/i18n/locales";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";

export interface OrganizationOption {
  id: string;
  name: string;
  role: string;
}

export function UserMenu({
  name,
  email,
  roleLabel,
  organizations = [],
  activeOrganizationId,
  canCreateOrganization = false,
}: {
  name: string;
  email: string;
  roleLabel: string;
  /** Every organization the user belongs to (AUTH-06). */
  organizations?: OrganizationOption[];
  activeOrganizationId?: string;
  canCreateOrganization?: boolean;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const t = useTranslations("insights.orgs");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [switching, startTransition] = useTransition();
  const switchLanguage = (next: string) =>
    startTransition(async () => {
      if (!isLocale(next) || next === locale) return;
      // The page re-renders in the new language, which is the confirmation.
      if ((await changeLocaleAction(next, "account")).ok) router.refresh();
    });
  const switchTo = (org: OrganizationOption) =>
    startTransition(async () => {
      const res = await switchOrganizationAction(org.id);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(t("switched", { name: res.data.name }));
      router.push("/dashboard");
      router.refresh();
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hover:bg-sidebar-accent/60 flex w-full items-center gap-3 rounded-md p-2 text-left"
        aria-busy={switching}
        data-testid="user-menu"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 group-data-[collapsed=true]/sidebar:sr-only">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="text-muted-foreground block truncate text-xs">{roleLabel}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="text-muted-foreground block truncate text-xs">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.length > 1 || canCreateOrganization ? (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-xs">{t("label")}</DropdownMenuLabel>
            {organizations.length > 1
              ? organizations.map((org) => {
                  const active = org.id === activeOrganizationId;
                  return (
                    <DropdownMenuItem
                      key={org.id}
                      disabled={switching}
                      aria-current={active ? "true" : undefined}
                      data-testid="org-option"
                      onSelect={() => {
                        if (!active) switchTo(org);
                      }}
                    >
                      <Building2 className="size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{org.name}</span>
                        <span className="text-muted-foreground block text-xs">{t(`role.${org.role}`)}</span>
                      </span>
                      {active ? <Check className="size-4" /> : null}
                    </DropdownMenuItem>
                  );
                })
              : null}
            {canCreateOrganization ? (
              <DropdownMenuItem asChild>
                <Link href="/onboarding?new=1">
                  <Plus className="size-4" /> {t("create")}
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Languages className="size-3.5" aria-hidden /> {tc("language.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={switchLanguage}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem
              key={l}
              value={l}
              lang={l}
              disabled={switching}
              data-testid={`language-${l}`}
            >
              {LOCALE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">{tc("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" /> {tc("theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" /> {tc("theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" /> {tc("theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.push("/");
            router.refresh();
          }}
        >
          <LogOut className="size-4" /> {tc("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
