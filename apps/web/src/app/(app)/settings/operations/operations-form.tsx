"use client";
import { parseMajor, toMajor } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateOperationsSettingsAction } from "./actions";

type Errors = Partial<Record<"auto_approve_below_minor" | "dispatcher_limit_minor", string>>;

const asInput = (minor: number, currency: Currency) =>
  toMajor(minor, currency).toFixed(currency === "IDR" ? 0 : 2);

export function OperationsForm(props: {
  currency: Currency;
  autoApproveBelowMinor: number;
  dispatcherLimitMinor: number;
  requireSignature: boolean;
}) {
  const t = useTranslations("expenses.settings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [auto, setAuto] = useState(asInput(props.autoApproveBelowMinor, props.currency));
  const [limit, setLimit] = useState(asInput(props.dispatcherLimitMinor, props.currency));
  const [signature, setSignature] = useState(props.requireSignature);
  const [errors, setErrors] = useState<Errors>({});
  const example = props.currency === "IDR" ? "500000" : "50.00";

  const submit = () => {
    const autoMinor = parseMajor(auto, props.currency);
    const limitMinor = parseMajor(limit, props.currency);
    const next: Errors = {};
    if (autoMinor === null || autoMinor < 0) next.auto_approve_below_minor = t("invalidAmount", { example });
    if (limitMinor === null || limitMinor < 0) next.dispatcher_limit_minor = t("invalidAmount", { example });
    setErrors(next);
    if (Object.keys(next).length) return;
    startTransition(async () => {
      const r = await updateOperationsSettingsAction({
        auto_approve_below_minor: autoMinor,
        dispatcher_limit_minor: limitMinor,
        require_signature: signature,
      });
      if (!r.ok) {
        const fields: Errors = {};
        for (const f of r.error.fields ?? []) fields[f.path as keyof Errors] = f.message;
        setErrors(fields);
        // Field problems show next to the fields; anything else as a toast.
        if (!Object.keys(fields).length) toast.error(r.error.message);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  };

  const amountField = (id: keyof Errors, label: string, value: string, onChange: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label} ({props.currency})
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        className="max-w-48"
        aria-invalid={Boolean(errors[id])}
        aria-describedby={errors[id] ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
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
          <CardTitle className="text-base">{t("approvalsTitle")}</CardTitle>
          <CardDescription>{t("approvalsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {amountField("auto_approve_below_minor", t("autoApprove"), auto, setAuto)}
          {amountField("dispatcher_limit_minor", t("dispatcherLimit"), limit, setLimit)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("completionTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Switch
              id="require-signature"
              checked={signature}
              onCheckedChange={setSignature}
              aria-describedby="require-signature-hint"
            />
            <div className="space-y-1">
              <Label htmlFor="require-signature">{t("requireSignature")}</Label>
              <p id="require-signature-hint" className="text-muted-foreground text-sm">
                {t("requireSignatureHint")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Button type="submit" disabled={pending} data-testid="operations-save">
        {pending ? <Loader2 className="animate-spin" /> : null}
        {t("save")}
      </Button>
    </form>
  );
}
