import { formatMoney, organization } from "@fieldops/core";
import { intlLocale } from "@/lib/format";
import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActor, runService } from "@/server/context";
import { ActiveSwitch, ServiceTypeDialog } from "./service-type-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("serviceTypes") };
}

export default async function ServiceTypesPage() {
  const actor = await requireActor();
  const t = await getTranslations("settings.serviceTypes");
  const locale = await getLocale();
  const { types, org } = await runService(
    async (ctx) => ({
      types: await organization.listServiceTypes(ctx, { includeInactive: true }),
      org: await organization.getOrganization(ctx),
    }),
    actor,
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <ServiceTypeDialog currency={org.currency} />
      </CardHeader>
      <CardContent>
        {types.length === 0 ? (
          <EmptyState icon={<Wrench />} title={t("empty")} description={t("emptyHint")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead className="text-right">{t("columns.duration")}</TableHead>
                <TableHead className="text-right">{t("columns.price")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("edit")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((st) => (
                <TableRow key={st.id} className={st.active ? undefined : "text-muted-foreground"}>
                  <TableCell className="max-w-72">
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: st.color ?? "var(--muted-foreground)" }}
                      />
                      <span className="truncate">{st.name}</span>
                    </span>
                    {st.description ? (
                      <span className="text-muted-foreground block truncate text-xs">{st.description}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t("minutes", { count: st.defaultDurationMin })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(
                      { amountMinor: st.defaultPriceMinor, currency: st.currency },
                      intlLocale(locale),
                    )}
                  </TableCell>
                  <TableCell>
                    <ActiveSwitch id={st.id} name={st.name} active={st.active} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ServiceTypeDialog
                      currency={org.currency}
                      serviceType={{
                        id: st.id,
                        name: st.name,
                        description: st.description,
                        defaultDurationMin: st.defaultDurationMin,
                        defaultPriceMinor: st.defaultPriceMinor,
                        color: st.color,
                        active: st.active,
                        currency: st.currency,
                        requiredSkills: st.requiredSkills,
                        checklistTemplate: st.checklistTemplate,
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
