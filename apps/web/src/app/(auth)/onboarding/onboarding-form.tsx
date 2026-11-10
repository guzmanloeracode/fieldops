"use client";
import { slugify } from "@fieldops/core";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createOrganizationAction } from "./actions";

const TIMEZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "Europe/London", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Australia/Sydney", "UTC"];

export function OnboardingForm({ name }: { name: string }) {
  const t = useTranslations("auth");
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState<"USD" | "IDR">("USD");
  const [country, setCountry] = useState("US");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setTimezone(tz);
    if (tz?.startsWith("Asia/J") || tz?.startsWith("Asia/Makassar") || tz?.startsWith("Asia/Jayapura")) {
      setCurrency("IDR");
      setCountry("ID");
    }
  }, []);

  const zones = TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("onboarding.title", { name: name.split(" ")[0] ?? name })}</CardTitle>
        <CardDescription>{t("onboarding.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await createOrganizationAction({ name: orgName, slug, timezone, currency, country });
              if (r && !r.ok) {
                setErrors(r.fields ?? {});
                setMessage(r.message);
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="org-name">{t("onboarding.orgName")}</Label>
            <Input
              id="org-name"
              value={orgName}
              required
              onChange={(e) => {
                setOrgName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
            <FieldError message={errors.name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">{t("onboarding.slug")}</Label>
            <Input
              id="slug"
              value={slug}
              required
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              aria-describedby="slug-hint"
            />
            <p id="slug-hint" className="text-muted-foreground text-xs">
              {t("onboarding.slugHint", { slug: slug || "your-company" })}
            </p>
            <FieldError message={errors.slug} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="tz">{t("onboarding.timezone")}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="tz" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">{t("onboarding.currency")}</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as "USD" | "IDR")}>
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="IDR">IDR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="country">{t("onboarding.country")}</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="ID">Indonesia</SelectItem>
                  <SelectItem value="SG">Singapore</SelectItem>
                  <SelectItem value="AU">Australia</SelectItem>
                  <SelectItem value="GB">United Kingdom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {message ? (
            <p role="alert" className="text-destructive text-sm">
              {message}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {t("onboarding.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
