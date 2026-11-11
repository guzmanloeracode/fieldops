import { catalog } from "@fieldops/core";
import { Package } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { money, percent } from "@/components/billing/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActor, runService } from "@/server/context";
import { CatalogItemDialog, CatalogActiveSwitch } from "./catalog-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("catalog") };
}

/** Parts and fees with prices, optional cost and tax (FIN-01). Owners and admins; the layout checks. */
export default async function CatalogSettingsPage() {
  const actor = await requireActor();
  const t = await getTranslations("billing.catalog");
  const locale = await getLocale();
  const data = await runService(
    async (ctx) => ({
      items: await catalog.listCatalog(ctx, { include_inactive: true, limit: 100 }),
      settings: await catalog.getBillingSettings(ctx),
    }),
    actor,
  );
  const { currency, taxRates } = data.settings;
  const rateName = (bps: number | null) =>
    bps === null
      ? t("defaultRate")
      : `${taxRates.find((r) => r.rate_bps === bps)?.name ?? ""} (${percent(bps, locale)})`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <CatalogItemDialog currency={currency} taxRates={taxRates} />
      </CardHeader>
      <CardContent>
        {data.items.length === 0 ? (
          <EmptyState icon={<Package />} title={t("empty")} description={t("emptyHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.name")}</TableHead>
                  <TableHead scope="col">{t("columns.sku")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("columns.price")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("columns.cost")}
                  </TableHead>
                  <TableHead scope="col">{t("columns.tax")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">{t("edit")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow
                    key={c.id}
                    className={c.active ? undefined : "text-muted-foreground"}
                    data-testid="catalog-row"
                  >
                    <TableCell className="max-w-72">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {t(`kinds.${c.kind}`)} · {t("per", { unit: c.unit })}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.sku ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(c.unitPriceMinor, c.currency, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.unitCostMinor === null ? "—" : money(c.unitCostMinor, c.currency, locale)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{rateName(c.taxRateBps)}</TableCell>
                    <TableCell>
                      <CatalogActiveSwitch id={c.id} name={c.name} active={c.active} />
                    </TableCell>
                    <TableCell className="text-right">
                      <CatalogItemDialog
                        currency={currency}
                        taxRates={taxRates}
                        item={{
                          id: c.id,
                          kind: c.kind,
                          name: c.name,
                          description: c.description,
                          sku: c.sku,
                          unit: c.unit,
                          unitPriceMinor: c.unitPriceMinor,
                          unitCostMinor: c.unitCostMinor,
                          taxRateBps: c.taxRateBps,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
