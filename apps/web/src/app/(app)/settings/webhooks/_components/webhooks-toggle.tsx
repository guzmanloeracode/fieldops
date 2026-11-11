"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useTransition } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setWebhooksEnabledAction } from "../actions";

/** Webhooks on or off for the organization. */
export function WebhooksToggle({
  enabled,
  configured,
  hint,
}: {
  enabled: boolean;
  configured: boolean;
  hint: string;
}) {
  const t = useTranslations("webhooks.toggle");
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{t("label")}</Label>
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={pending || (!configured && !enabled)}
        aria-describedby={`${id}-hint`}
        onCheckedChange={(on) =>
          startTransition(async () => {
            const res = await setWebhooksEnabledAction(on);
            if (!res.ok) {
              toast.error(res.error.message);
              return;
            }
            toast.success(on ? t("turnedOn") : t("turnedOff"));
            router.refresh();
          })
        }
      />
    </div>
  );
}
