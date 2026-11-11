import { UnavailableError, webhooks } from "@fieldops/core";
import { WEBHOOK_DELIVERY_STATUSES, type WebhookDeliveryStatus } from "@fieldops/shared";
import { AlertTriangle, ArrowLeft, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireActor } from "@/server/context";
import { webhookDeps } from "@/server/relay";
import { DeliveryDetails, RedeliverButton } from "../_components/delivery-actions";
import { EndpointActions } from "../_components/endpoint-actions";
import { disabledReasonText, DeliveryStatusBadge, EndpointStatusBadge } from "../_components/status";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("webhooks") };
}

const PAGE_SIZE = 25;

/** One endpoint: its settings and actions, and its delivery log with attempts and redelivery (PLT-03). */
export default async function WebhookEndpointPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const status = (WEBHOOK_DELIVERY_STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as WebhookDeliveryStatus)
    : undefined;
  const cursor = sp.cursor && /^[\w.-]{1,200}$/.test(sp.cursor) ? sp.cursor : undefined;
  const actor = await requireActor();
  const t = await getTranslations("webhooks");
  const locale = await getLocale();
  const tz = actor.organization.timezone;
  const deps = webhookDeps(actor);
  const when = (v: string | null) => formatDateTime(v, tz, locale);

  let data;
  try {
    const endpoint = await webhooks.getEndpoint(deps, id);
    const page = await webhooks.listDeliveries(deps, id, { status, cursor, limit: PAGE_SIZE });
    data = { endpoint, page };
  } catch (err) {
    if (!(err instanceof UnavailableError)) throw err;
  }

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href="/settings/webhooks">
        <ArrowLeft /> {t("detail.back")}
      </Link>
    </Button>
  );
  if (!data) {
    return (
      <div className="space-y-4">
        {back}
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>{t("unavailable.title")}</AlertTitle>
          <AlertDescription>{t("unavailable.body")}</AlertDescription>
        </Alert>
      </div>
    );
  }
  const { endpoint, page } = data;
  const href = (q: { status?: string; cursor?: string }) => {
    const p = new URLSearchParams();
    if (q.status) p.set("status", q.status);
    if (q.cursor) p.set("cursor", q.cursor);
    const s = p.toString();
    return `/settings/webhooks/${endpoint.id}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      {back}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="min-w-0 font-mono text-base break-all">{endpoint.url}</CardTitle>
            <EndpointStatusBadge endpoint={endpoint} />
          </div>
          <CardDescription>
            {endpoint.description ? <span className="block">{endpoint.description}</span> : null}
            {t("detail.created", { date: when(endpoint.created_at) })}
          </CardDescription>
          {!endpoint.enabled ? (
            <p className="text-muted-foreground text-sm">
              {disabledReasonText((k, v) => t(`status.${k}`, v), endpoint.disabled_reason)}
            </p>
          ) : endpoint.failure_streak > 0 ? (
            <p className="text-destructive text-sm">
              {t("status.failingSince", {
                count: endpoint.failure_streak,
                date: when(endpoint.failing_since),
              })}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">{t("detail.subscribed")}</h2>
            {endpoint.event_types.includes("*") ? (
              <p className="text-sm">{t("endpoints.allEvents")}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {endpoint.event_types.map((e) => (
                  <li key={e}>
                    <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{e}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <EndpointActions endpoint={endpoint} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("deliveries.title")}</CardTitle>
          <CardDescription>{t("deliveries.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <nav aria-label={t("deliveries.filter")}>
            <ul className="flex flex-wrap gap-1.5">
              {[undefined, ...WEBHOOK_DELIVERY_STATUSES].map((s) => {
                const active = s === status;
                return (
                  <li key={s ?? "all"}>
                    <Link
                      href={href({ status: s })}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex rounded-full border px-3 py-1 text-xs",
                        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
                      )}
                    >
                      {s ? t(`deliveryStatus.${s}`) : t("deliveries.all")}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {page.items.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title={status ? t("deliveries.emptyFiltered") : t("deliveries.empty")}
              description={status ? undefined : t("deliveries.emptyHint")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("deliveries.columns.time")}</TableHead>
                  <TableHead>{t("deliveries.columns.event")}</TableHead>
                  <TableHead>{t("deliveries.columns.status")}</TableHead>
                  <TableHead className="text-right">{t("deliveries.columns.attempts")}</TableHead>
                  <TableHead className="text-right">{t("deliveries.columns.response")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("deliveries.details")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((d) => (
                  <TableRow key={d.id} data-testid="webhook-delivery">
                    <TableCell className="whitespace-nowrap">{when(d.created_at)}</TableCell>
                    <TableCell>
                      {d.event_type ? (
                        <code className="text-xs">{d.event_type}</code>
                      ) : (
                        <span className="text-muted-foreground text-xs">{t("deliveries.unknownEvent")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DeliveryStatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t("deliveries.attempts", { count: String(d.attempts), max: String(d.max_attempts) })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.last_status_code ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <RedeliverButton delivery={d} />
                        <DeliveryDetails delivery={d} timeZone={tz} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {cursor || page.next_cursor ? (
            <nav aria-label={t("deliveries.title")} className="flex justify-end gap-2">
              {cursor ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ status })}>{t("deliveries.newest")}</Link>
                </Button>
              ) : null}
              {page.next_cursor ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ status, cursor: page.next_cursor })}>{t("deliveries.older")}</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
