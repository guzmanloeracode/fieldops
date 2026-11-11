import type { WebhookDeliveryStatus, WebhookEndpointRepr } from "@fieldops/shared";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DISABLED_BY_API = "disabled through the API";

/** Active, off (by a person or by Relay), or failing (attempts failing in a row). */
export function EndpointStatusBadge({ endpoint }: { endpoint: WebhookEndpointRepr }) {
  const t = useTranslations("webhooks.status");
  if (!endpoint.enabled) return <Badge variant="secondary">{t("off")}</Badge>;
  if (endpoint.failure_streak > 0) return <Badge variant="destructive">{t("failing")}</Badge>;
  return (
    <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
      {t("active")}
    </Badge>
  );
}

/** Why an endpoint is off, in words. */
export function disabledReasonText(
  t: (key: string, values?: Record<string, string>) => string,
  reason: string | null,
): string {
  if (!reason || reason === DISABLED_BY_API) return t("offByYou");
  return t("offByRelay", { reason });
}

const DELIVERY_STYLE: Record<WebhookDeliveryStatus, string> = {
  pending: "",
  retrying: "border-amber-600/40 text-amber-800 dark:text-amber-300",
  delivered: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  dead: "border-destructive/50 text-destructive",
};

export function DeliveryStatusBadge({ status }: { status: WebhookDeliveryStatus }) {
  const t = useTranslations("webhooks.deliveryStatus");
  return (
    <Badge variant="outline" className={cn(DELIVERY_STYLE[status])}>
      {t(status)}
    </Badge>
  );
}
