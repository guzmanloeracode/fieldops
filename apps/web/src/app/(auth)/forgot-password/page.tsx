"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "../_actions/account";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("forgot.title")}</CardTitle>
        <CardDescription>{sent ? t("forgot.sent") : t("forgot.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent ? (
          <Button asChild variant="outline" className="w-full">
            <Link href="/demo-inbox">{t("checkEmail.openInbox")}</Link>
          </Button>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const email = String(new FormData(e.currentTarget).get("email"));
              startTransition(async () => {
                const r = await requestPasswordResetAction(email);
                if (!r.ok) setError(r.message);
                else setSent(true);
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">{t("fields.email")}</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("forgot.submit")}
            </Button>
          </form>
        )}
        <Link href="/sign-in" className="text-primary block text-center text-sm hover:underline">
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </Card>
  );
}
