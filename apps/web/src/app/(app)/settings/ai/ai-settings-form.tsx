"use client";
import type { AiLimits, AiProvider, AiUsageSummary } from "@fieldops/core";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateAiSettingsAction } from "./actions";

const fmt = new Intl.NumberFormat("en-US");

export function AiSettingsForm(props: {
  enabled: boolean;
  monthlyQuota: number;
  provider: AiProvider;
  model: string;
  usage: AiUsageSummary;
  acceptanceRate: number | null;
  limits: AiLimits;
}) {
  const t = useTranslations("ai.settings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(props.enabled);
  const [quota, setQuota] = useState(String(props.monthlyQuota));
  const [error, setError] = useState<string | undefined>();
  const { usage } = props;

  const submit = () => {
    const n = Number(quota);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) {
      setError(t("invalidQuota"));
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const r = await updateAiSettingsAction({ enabled, monthly_quota: n });
      if (!r.ok) {
        const field = r.error.fields?.find((f) => f.path === "monthly_quota");
        if (field) setError(field.message);
        else toast.error(r.error.message);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  };

  const stats = [
    {
      key: "calls",
      label: t("usage.calls"),
      value: t("usage.callsOf", { used: fmt.format(usage.calls), limit: fmt.format(props.monthlyQuota) }),
    },
    {
      key: "acceptance",
      label: t("usage.acceptance"),
      value: props.acceptanceRate === null ? "—" : `${Math.round(props.acceptanceRate * 100)}%`,
    },
    {
      key: "tokens",
      label: t("usage.tokens"),
      value: t("usage.tokensValue", {
        input: fmt.format(usage.inputTokens),
        output: fmt.format(usage.outputTokens),
      }),
    },
    { key: "cache", label: t("usage.cache"), value: fmt.format(usage.cacheReadTokens) },
    {
      key: "latency",
      label: t("usage.latency"),
      value: usage.calls ? t("usage.seconds", { s: (usage.avgLatencyMs / 1000).toFixed(1) }) : "—",
    },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {t("title")}
            <Badge
              variant={props.provider === "unavailable" ? "outline" : "secondary"}
              data-testid="ai-provider"
            >
              {t(`provider.${props.provider}`, { model: props.model })}
            </Badge>
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {props.provider === "unavailable" ? (
            <p className="text-muted-foreground text-sm">{t("notConfiguredHint")}</p>
          ) : null}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="ai-enabled">{t("enabled")}</Label>
              <p className="text-muted-foreground text-sm" id="ai-enabled-hint">
                {t("enabledHint")}
              </p>
            </div>
            <Switch
              id="ai-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-describedby="ai-enabled-hint"
              data-testid="ai-enabled"
            />
          </div>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="ai-quota">{t("quota")}</Label>
            <Input
              id="ai-quota"
              type="number"
              min={0}
              max={100000}
              inputMode="numeric"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby="ai-quota-hint"
            />
            <p className="text-muted-foreground text-xs" id="ai-quota-hint">
              {t("quotaHint")}
            </p>
            <FieldError message={error} />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={submit} disabled={pending} data-testid="ai-save">
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("usage.title")}</CardTitle>
          <CardDescription>{t("usage.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3" data-testid="ai-usage">
            {stats.map((s) => (
              <div key={s.key} className="rounded-lg border p-3">
                <dt className="text-muted-foreground text-xs font-medium">{s.label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-sm">
            {t("usage.outcomes", {
              accepted: usage.outcomes.accepted,
              edited: usage.outcomes.edited,
              discarded: usage.outcomes.discarded,
              failed: usage.outcomes.failed + usage.outcomes.refused,
              open: usage.outcomes.drafted,
            })}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("limits", {
              user: props.limits.perUserPerHour,
              visitor: props.limits.perVisitorPerDay ?? 0,
              global: props.limits.globalPerDay,
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
