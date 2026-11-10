import { audit, type AuditEntryRecord } from "@fieldops/core";
import { AUDIT_ENTITY_TYPES, AUDIT_OPERATIONS, type Currency } from "@fieldops/shared";
import { Download, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { NativeSelect } from "@/components/app/native-select";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { actorLabel, describeAction, entityHref, entityName, formatValue } from "./format";

export const metadata: Metadata = { title: "Audit log" };

const FILTERS = ["actor", "entity_type", "operation", "entity_id", "from", "to"] as const;

/** The audit log viewer (AUD-03): newest first, filtered in the URL, keyset pages, CSV export. */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;
  const value = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const query: Record<string, string> = {};
  for (const k of [...FILTERS, "cursor"]) if (value(k)) query[k] = value(k);
  const t = await getTranslations("audit");
  const [page, actors] = await Promise.all([
    runService((ctx) => audit.listAuditLog(ctx, { ...query, limit: 50 }), actor).catch(() =>
      runService((ctx) => audit.listAuditLog(ctx, { limit: 50 }), actor),
    ),
    runService((ctx) => audit.listAuditActors(ctx), actor),
  ]);
  const filters = new URLSearchParams(Object.entries(query).filter(([k]) => k !== "cursor"));
  const withCursor = (cursor: string) => {
    const p = new URLSearchParams(filters);
    p.set("cursor", cursor);
    return `/settings/audit?${p}`;
  };
  const fmt = { timeZone: actor.organization.timezone, currency: actor.organization.currency as Currency };
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label={t("title")}>
        <div className="space-y-1.5">
          <Label htmlFor="audit-actor">{t("filters.actor")}</Label>
          <NativeSelect id="audit-actor" name="actor" defaultValue={value("actor")}>
            <option value="">{t("filters.anyone")}</option>
            <option value="system">{t("filters.system")}</option>
            {actors.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-entity">{t("filters.entity")}</Label>
          <NativeSelect id="audit-entity" name="entity_type" defaultValue={value("entity_type")}>
            <option value="">{t("filters.anyEntity")}</option>
            {AUDIT_ENTITY_TYPES.map((e) => (
              <option key={e} value={e}>
                {t(`entityTypes.${e}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-operation">{t("filters.operation")}</Label>
          <NativeSelect id="audit-operation" name="operation" defaultValue={value("operation")}>
            <option value="">{t("filters.anyOperation")}</option>
            {AUDIT_OPERATIONS.map((o) => (
              <option key={o} value={o}>
                {t(`operations.${o}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-from">{t("filters.from")}</Label>
          <Input id="audit-from" name="from" type="date" defaultValue={value("from")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-to">{t("filters.to")}</Label>
          <Input id="audit-to" name="to" type="date" defaultValue={value("to")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-entity-id">{t("filters.entityId")}</Label>
          <Input id="audit-entity-id" name="entity_id" defaultValue={value("entity_id")} autoComplete="off" />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit" size="sm">
            {t("filters.apply")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/settings/audit">{t("filters.clear")}</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <a href={`/settings/audit/export?${filters}`} data-testid="audit-export">
              <Download aria-hidden /> {t("filters.export")}
            </a>
          </Button>
        </div>
      </form>
      {page.rows.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <ol aria-label={t("entries")} className="divide-y">
              {page.rows.map((e) => (
                <Entry key={e.id} e={e} t={t} fmt={fmt} />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
      {query.cursor || page.nextCursor ? (
        <nav aria-label={t("pagination")} className="flex justify-between gap-2">
          {query.cursor ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/settings/audit?${filters}`}>{t("newer")}</Link>
            </Button>
          ) : (
            <span />
          )}
          {page.nextCursor ? (
            <Button asChild size="sm" variant="outline">
              <Link href={withCursor(page.nextCursor)} data-testid="audit-older">
                {t("older")}
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"audit">>>;

function Entry({ e, t, fmt }: { e: AuditEntryRecord; t: T; fmt: { timeZone: string; currency: Currency } }) {
  const tt = t as unknown as (key: string, values?: Record<string, string>) => string;
  const changes = audit.auditChanges(e);
  const href = entityHref(e);
  const entity = entityName(tt, e.entityType);
  return (
    <li className="space-y-2 px-4 py-3 sm:px-6" data-testid="audit-entry">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-medium">{actorLabel(tt, e)}</span> {describeAction(tt, e)}
          {href ? (
            <>
              {" · "}
              <Link href={href} className="text-primary hover:underline">
                {e.job ? `JOB-${String(e.job.number).padStart(6, "0")}` : t("view", { entity })}
              </Link>
            </>
          ) : null}
        </p>
        <time className="text-muted-foreground text-xs" dateTime={e.createdAt.toISOString()}>
          {formatDateTime(e.createdAt, fmt.timeZone)}
        </time>
      </div>
      {changes.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-md text-xs">
            <caption className="sr-only">{t("changes")}</caption>
            <thead className="text-muted-foreground text-left">
              <tr>
                <th scope="col" className="w-1/4 py-1 pr-3 font-medium">
                  {t("field")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("before")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t("after")}
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.slice(0, 12).map((c) => (
                <tr key={c.field} className="align-top">
                  <th scope="row" className="py-0.5 pr-3 font-mono font-normal">
                    {c.field}
                  </th>
                  <td className="text-muted-foreground py-0.5 pr-3 break-all">
                    {formatValue(tt, c.field, c.before, fmt)}
                  </td>
                  <td className="py-0.5 break-all">{formatValue(tt, c.field, c.after, fmt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {e.ip || e.userAgent ? (
        <p className="text-muted-foreground truncate text-xs">
          {e.ip ? t("from", { ip: e.ip }) : null}
          {e.ip && e.userAgent ? " · " : null}
          {e.userAgent}
        </p>
      ) : null}
    </li>
  );
}
