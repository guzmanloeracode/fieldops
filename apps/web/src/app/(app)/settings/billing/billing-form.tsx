"use client";
import type { Currency } from "@fieldops/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { fromInput, toInput } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateBillingSettingsAction } from "./actions";

type Field =
  | "payment_terms_days"
  | "quote_validity_days"
  | "labor_rate_minor"
  | "invoice_prefix"
  | "quote_prefix"
  | "payment_instructions";

/** Billing settings (FIN-02, FIN-03, FIN-06). */
export function BillingSettingsForm({
  currency,
  settings,
}: {
  currency: Currency;
  settings: {
    paymentTermsDays: number;
    quoteValidityDays: number;
    laborRateMinor: number;
    invoicePrefix: string;
    quotePrefix: string;
    remindersEnabled: boolean;
    paymentInstructions: string | null;
  };
}) {
  const t = useTranslations("billing.settings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [terms, setTerms] = useState(String(settings.paymentTermsDays));
  const [validity, setValidity] = useState(String(settings.quoteValidityDays));
  const [labor, setLabor] = useState(toInput(settings.laborRateMinor, currency));
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix);
  const [quotePrefix, setQuotePrefix] = useState(settings.quotePrefix);
  const [reminders, setReminders] = useState(settings.remindersEnabled);
  const [instructions, setInstructions] = useState(settings.paymentInstructions ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const submit = () => {
    const laborMinor = fromInput(labor, currency);
    const days = (v: string) => (/^\d{1,3}$/.test(v.trim()) ? Number(v) : null);
    const next: Partial<Record<Field, string>> = {};
    if (days(terms) === null) next.payment_terms_days = t("invalidDays");
    if (!days(validity)) next.quote_validity_days = t("invalidDays");
    if (laborMinor === null) next.labor_rate_minor = t("invalidAmount");
    setErrors(next);
    if (Object.keys(next).length) return;
    startTransition(async () => {
      const r = await updateBillingSettingsAction({
        payment_terms_days: days(terms),
        quote_validity_days: days(validity),
        labor_rate_minor: laborMinor,
        invoice_prefix: invoicePrefix,
        quote_prefix: quotePrefix,
        reminders_enabled: reminders,
        payment_instructions: instructions,
      });
      if (!r.ok) {
        const fields: Partial<Record<Field, string>> = {};
        for (const f of r.error.fields ?? []) fields[f.path as Field] = f.message;
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(r.error.message);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  };

  const input = (
    id: Field,
    label: string,
    value: string,
    set: (v: string) => void,
    hint?: string,
    mode?: "numeric" | "decimal",
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode={mode}
        className="max-w-48"
        aria-invalid={Boolean(errors[id])}
        aria-describedby={
          [hint ? `${id}-hint` : "", errors[id] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined
        }
        onChange={(e) => set(e.target.value)}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={errors[id]} />
    </div>
  );

  return (
    <form
      className="max-w-2xl space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("termsTitle")}</CardTitle>
          <CardDescription>{t("termsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {input("payment_terms_days", t("paymentTerms"), terms, setTerms, t("paymentTermsHint"), "numeric")}
          {input(
            "quote_validity_days",
            t("quoteValidity"),
            validity,
            setValidity,
            t("quoteValidityHint"),
            "numeric",
          )}
          {input(
            "labor_rate_minor",
            t("laborRate", { currency }),
            labor,
            setLabor,
            t("laborRateHint"),
            "decimal",
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("numberingTitle")}</CardTitle>
          <CardDescription>{t("numberingDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {input(
            "invoice_prefix",
            t("invoicePrefix"),
            invoicePrefix,
            setInvoicePrefix,
            t("prefixExample", { example: `${invoicePrefix.toUpperCase() || "INV"}-2026-0001` }),
          )}
          {input(
            "quote_prefix",
            t("quotePrefix"),
            quotePrefix,
            setQuotePrefix,
            t("prefixExample", { example: `${quotePrefix.toUpperCase() || "QUO"}-2026-0001` }),
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("paymentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="payment_instructions">{t("paymentInstructions")}</Label>
            <Textarea
              id="payment_instructions"
              rows={3}
              value={instructions}
              aria-describedby="payment_instructions-hint"
              onChange={(e) => setInstructions(e.target.value)}
            />
            <p id="payment_instructions-hint" className="text-muted-foreground text-xs">
              {t("paymentInstructionsHint")}
            </p>
            <FieldError message={errors.payment_instructions} />
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="reminders"
              checked={reminders}
              onCheckedChange={setReminders}
              aria-describedby="reminders-hint"
            />
            <div className="space-y-1">
              <Label htmlFor="reminders">{t("reminders")}</Label>
              <p id="reminders-hint" className="text-muted-foreground text-sm">
                {t("remindersHint")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Button type="submit" disabled={pending} data-testid="billing-save">
        {pending ? <Loader2 className="animate-spin" /> : null}
        {t("save")}
      </Button>
    </form>
  );
}
