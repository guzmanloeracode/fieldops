import { UnavailableError, webhooks } from "@fieldops/core";
import { MAX_WEBHOOK_ENDPOINTS_PER_ORG, type WebhookEndpointRepr } from "@fieldops/shared";
import { AlertTriangle, Webhook } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { requireActor } from "@/server/context";
import { webhookDeps } from "@/server/relay";
import { EndpointDialog } from "../_components/endpoint-dialog";
import { EventCatalog, VerifyCard } from "../_components/docs";
import { EndpointStatusBadge } from "../_components/status";
import { WebhooksToggle } from "../_components/webhooks-toggle";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("webhooks") };
}

/** Outgoing webhooks (PLT-03): on or off, the endpoints, how to verify requests and the event catalog. */
export default async function WebhooksPage() {
  const actor = await requireActor();
  const t = await getTranslations("webhooks");
  const locale = await getLocale();
  const deps = webhookDeps(actor);
  const settings = await webhooks.getSettings(deps);
  let endpoints: WebhookEndpointRepr[] = [];
  let unavailable = false;
  if (settings.configured) {
    try {
      endpoints = await webhooks.listEndpoints(deps);
    } catch (err) {
      if (!(err instanceof UnavailableError)) throw err;
      unavailable = true;
    }
  }
  const full = endpoints.length >= MAX_WEBHOOK_ENDPOINTS_PER_ORG;
  const canAdd = settings.configured && settings.enabled && !unavailable && !full;
  const tz = actor.organization.timezone;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!settings.configured ? (
            <Alert>
              <AlertTriangle aria-hidden />
              <AlertTitle>{t("notConfigured.title")}</AlertTitle>
              <AlertDescription>{t("notConfigured.body")}</AlertDescription>
            </Alert>
          ) : null}
          {unavailable ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>{t("unavailable.title")}</AlertTitle>
              <AlertDescription>{t("unavailable.body")}</AlertDescription>
            </Alert>
          ) : null}
          <WebhooksToggle
            enabled={settings.enabled}
            configured={settings.configured}
            hint={
              settings.enabled
                ? t("toggle.on", { date: formatDateTime(settings.enabled_at, tz, locale) })
                : t("toggle.off")
            }
          />
          <section aria-labelledby="webhook-endpoints" className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <h2 id="webhook-endpoints" className="font-semibold">
                  {t("endpoints.title")}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {full
                    ? t("endpoints.limit", { max: MAX_WEBHOOK_ENDPOINTS_PER_ORG })
                    : t("endpoints.description", { max: MAX_WEBHOOK_ENDPOINTS_PER_ORG })}
                </p>
              </div>
              <EndpointDialog disabled={!canAdd} disabledHint={t("endpoints.addDisabled")} />
            </div>
            {endpoints.length === 0 ? (
              <EmptyState
                icon={<Webhook />}
                title={t("endpoints.empty")}
                description={t("endpoints.emptyHint")}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("endpoints.columns.url")}</TableHead>
                    <TableHead>{t("endpoints.columns.events")}</TableHead>
                    <TableHead>{t("endpoints.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell className="max-w-80">
                        <Link
                          href={`/settings/webhooks/${ep.id}`}
                          className="block truncate font-medium underline-offset-4 hover:underline"
                          title={ep.url}
                        >
                          {ep.url}
                        </Link>
                        {ep.description ? (
                          <span className="text-muted-foreground block truncate text-xs">
                            {ep.description}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {ep.event_types.includes("*")
                          ? t("endpoints.allEvents")
                          : t("endpoints.eventCount", { count: ep.event_types.length })}
                      </TableCell>
                      <TableCell>
                        <EndpointStatusBadge endpoint={ep} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </CardContent>
      </Card>
      <VerifyCard />
      <EventCatalog />
    </div>
  );
}
