"use client";
import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "../_actions/account";

export function SignUpForm({ demo, defaultEmail, next }: { demo: boolean; defaultEmail: string; next?: string }) {
  const t = useTranslations("auth");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <MailCheck className="text-primary mb-2 size-8" aria-hidden />
          <CardTitle className="text-xl">{t("checkEmail.title")}</CardTitle>
          <CardDescription>{t("checkEmail.description", { email: sentTo })}</CardDescription>
        </CardHeader>
        {demo ? (
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">{t("checkEmail.demoHint")}</p>
            <Button asChild className="w-full">
              <Link href="/demo-inbox">{t("checkEmail.openInbox")}</Link>
            </Button>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("signUp.title")}</CardTitle>
        <CardDescription>{t("signUp.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const email = String(f.get("email"));
            startTransition(async () => {
              const r = await signUpAction({ name: String(f.get("name")), email, password: String(f.get("password")), next });
              if (!r.ok) {
                setErrors(r.fields ?? {});
                setMessage(r.message);
                return;
              }
              setSentTo(email);
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="name">{t("fields.name")}</Label>
            <Input id="name" name="name" autoComplete="name" required aria-invalid={Boolean(errors.name)} />
            <FieldError message={errors.name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("fields.email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" defaultValue={defaultEmail} required aria-invalid={Boolean(errors.email)} />
            <FieldError message={errors.email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("fields.password")}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-invalid={Boolean(errors.password)} aria-describedby="password-hint" />
            <p id="password-hint" className="text-muted-foreground text-xs">
              {t("fields.passwordHint")}
            </p>
            <FieldError message={errors.password} />
          </div>
          {message ? (
            <p role="alert" className="text-destructive text-sm">
              {message}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {t("signUp.submit")}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            {t("signUp.haveAccount")}{" "}
            <Link href="/sign-in" className="text-primary hover:underline">
              {t("signIn.title")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
