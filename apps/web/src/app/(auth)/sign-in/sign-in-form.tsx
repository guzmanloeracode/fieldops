"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        const { error } = await authClient.signIn.email({
          email: String(form.get("email")),
          password: String(form.get("password")),
        });
        setPending(false);
        if (error) {
          setError(
            error.status === 403
              ? t("errors.verifyFirst")
              : error.status === 429
                ? t("errors.tooMany")
                : error.code === "INVALID_EMAIL_OR_PASSWORD"
                  ? t("errors.invalidCredentials")
                  : t("errors.signInFailed"),
          );
          return;
        }
        router.push(next);
        router.refresh();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">{t("fields.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("fields.password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} {t("signIn.submit")}
      </Button>
    </form>
  );
}
