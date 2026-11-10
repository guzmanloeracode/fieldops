"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPortalLinkAction } from "../actions";

export function PortalSignInForm({ slug, orgName, demo }: { slug: string; orgName: string; demo: boolean }) {
  const t = useTranslations("portal.signIn");
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (sent) {
    return (
      <div className="space-y-4" role="status">
        <p className="font-medium">{t("sentTitle")}</p>
        <p className="text-muted-foreground text-sm">{t("sent", { email: sent, org: orgName })}</p>
        <div className="flex flex-wrap gap-2">
          {demo ? (
            <Button asChild>
              <Link href="/demo-inbox">{t("openInbox")}</Link>
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setSent(null)}>
            {t("again")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const email = String(new FormData(e.currentTarget).get("email") ?? "");
        setError(null);
        startTransition(async () => {
          const r = await requestPortalLinkAction(slug, email);
          if (r.ok) setSent(email.trim());
          else setError(r.message);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="portal-email">{t("email")}</Label>
        <Input
          id="portal-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={error ? "portal-email-error" : undefined}
        />
      </div>
      {error ? (
        <p id="portal-email-error" role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending} data-testid="portal-request-link">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {t("submit")}
      </Button>
    </form>
  );
}
