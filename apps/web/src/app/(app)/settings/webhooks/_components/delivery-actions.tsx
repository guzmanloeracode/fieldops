"use client";
import type { WebhookDeliveryDetailRepr, WebhookDeliveryRepr } from "@fieldops/shared";
import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { getDeliveryAction, redeliverAction } from "../actions";
import { DeliveryStatusBadge } from "./status";

/** Only a dead delivery that wasn't redelivered yet can be sent again (Relay's dead-letter replay). */
export const canRedeliver = (d: WebhookDeliveryRepr) => d.status === "dead" && !d.replayed_at;

export function RedeliverButton({ delivery }: { delivery: WebhookDeliveryRepr }) {
  const t = useTranslations("webhooks.deliveries");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!canRedeliver(delivery)) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await redeliverAction(delivery.endpoint_id, delivery.id);
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success(t("redelivered"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t("redeliver")}
    </Button>
  );
}

/** A delivery and each of its attempts, loaded when opened. */
export function DeliveryDetails({ delivery, timeZone }: { delivery: WebhookDeliveryRepr; timeZone: string }) {
  const t = useTranslations("webhooks");
  const locale = useLocale();
  const [detail, setDetail] = useState<WebhookDeliveryDetailRepr | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const when = (v: string | null) => formatDateTime(v, timeZone, locale);
  const d = detail ?? delivery;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open || detail) return;
        startTransition(async () => {
          const res = await getDeliveryAction(delivery.id);
          if (res.ok) setDetail(res.data);
          else setFailed(true);
        });
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          {t("deliveries.details")}
          <span className="sr-only">: {delivery.event_type ?? delivery.event_id}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base break-all">
            {t("deliveries.detailsTitle", { id: d.id })}
          </DialogTitle>
          <DialogDescription>
            {d.event_type ? <code>{d.event_type}</code> : t("deliveries.unknownEvent")} · {when(d.created_at)}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">{t("deliveries.columns.status")}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <DeliveryStatusBadge status={d.status} />
            {d.dead_reason ? (
              <span className="text-muted-foreground">
                {t("deliveries.deadReason", {
                  reason: t.has(`deadReasons.${d.dead_reason}`)
                    ? t(`deadReasons.${d.dead_reason}`)
                    : d.dead_reason,
                })}
              </span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">{t("deliveries.eventId")}</dt>
          <dd className="font-mono text-xs break-all">{d.event_id}</dd>
          <dt className="text-muted-foreground">{t("deliveries.columns.attempts")}</dt>
          <dd>
            {t("deliveries.attempts", { count: String(d.attempts), max: String(d.max_attempts) })}
            {d.next_attempt_at
              ? ` · ${t("deliveries.nextAttempt", { date: when(d.next_attempt_at) })}`
              : null}
          </dd>
          {d.replay_of ? (
            <>
              <dt className="text-muted-foreground">{t("deliveries.redeliver")}</dt>
              <dd className="font-mono text-xs break-all">{t("deliveries.replayOf", { id: d.replay_of })}</dd>
            </>
          ) : null}
          {d.replayed_at ? (
            <>
              <dt className="text-muted-foreground">{t("deliveries.redeliver")}</dt>
              <dd>{t("deliveries.replayed", { date: when(d.replayed_at) })}</dd>
            </>
          ) : null}
        </dl>
        <section aria-labelledby={`att-${delivery.id}`} className="space-y-2">
          <h3 id={`att-${delivery.id}`} className="text-sm font-medium">
            {t("deliveries.attemptLog")}
          </h3>
          {pending ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
            </p>
          ) : failed ? (
            <p role="alert" className="text-destructive text-sm">
              {t("deliveries.loadFailed")}
            </p>
          ) : detail && detail.attempt_log.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("deliveries.noAttempts")}</p>
          ) : (
            <ol className="space-y-2">
              {detail?.attempt_log.map((a) => (
                <li key={a.attempt} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{t("deliveries.attempt", { n: String(a.attempt) })}</span>
                    <span className="text-muted-foreground">{when(a.started_at)}</span>
                    <span className="tabular-nums">{a.status_code ?? t("deliveries.noResponse")}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {t("deliveries.latency", { ms: String(a.latency_ms) })}
                    </span>
                  </div>
                  {a.error ? <p className="text-destructive mt-1 text-xs">{a.error}</p> : null}
                  {a.response_excerpt ? (
                    <pre
                      aria-label={t("deliveries.response")}
                      className="bg-muted mt-2 max-h-32 overflow-auto rounded p-2 text-xs whitespace-pre-wrap"
                    >
                      {a.response_excerpt}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
        <div className="flex justify-end">
          <RedeliverButton delivery={d} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
