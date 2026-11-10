import { can, customers, dates, formatJobNumber, NotFoundError, warrantyStatus } from "@fieldops/core";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { EquipmentDialog } from "../../customers/_components/equipment-dialog";
import { WarrantyBadge } from "../../customers/_components/warranty-badge";
import { DeleteEquipmentButton } from "./delete-equipment-button";

export const metadata: Metadata = { title: "Equipment" };

/** One unit: details, warranty and service history (CUS-03). */
export default async function EquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await requireActor();
  const t = await getTranslations("insights.equipment");
  const tz = actor.organization.timezone;
  const data = await runService((ctx) => customers.getEquipmentDetail(ctx, id), actor).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const { equipment: unit, site, customer, history } = data;
  const status = warrantyStatus(unit.warrantyEnd, dates.localDateString(new Date(), tz));
  const canUpdate = can(actor, "customers.update");
  const title = [unit.brand, unit.type].filter(Boolean).join(" ");
  const facts: [string, string][] = [
    [t("type"), unit.type],
    [t("brand"), unit.brand ?? "—"],
    [t("model"), unit.model ?? "—"],
    [t("serial"), unit.serial ?? "—"],
    [t("installDate"), unit.installDate ? formatDate(`${unit.installDate}T12:00:00Z`, "UTC") : "—"],
    [t("warrantyEnd"), unit.warrantyEnd ? formatDate(`${unit.warrantyEnd}T12:00:00Z`, "UTC") : "—"],
  ];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/customers/${customer.id}`} className="hover:underline">
            {customer.name} · {site.label}
          </Link>
        }
        title={title}
        description={<WarrantyBadge status={status} label={t(`warranty.${status}`)} />}
        actions={
          <>
            {can(actor, "jobs.create") ? (
              <Button asChild>
                <Link href={`/jobs/new?customer=${customer.id}`}>
                  <Plus /> {t("newJob")}
                </Link>
              </Button>
            ) : null}
            {canUpdate ? (
              <>
                <EquipmentDialog
                  customerId={customer.id}
                  siteId={site.id}
                  siteLabel={site.label}
                  unit={{ ...unit, notes: unit.notes ?? null }}
                />
                <DeleteEquipmentButton id={unit.id} customerId={customer.id} name={title} />
              </>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="font-medium break-words">{value}</dd>
                </div>
              ))}
              <div className="col-span-2">
                <dt className="text-muted-foreground text-xs">{t("site")}</dt>
                <dd className="font-medium">
                  {site.label} · {site.address.line1}, {site.address.city}
                </dd>
              </div>
              {unit.notes ? (
                <div className="col-span-2">
                  <dt className="text-muted-foreground text-xs">{t("notes")}</dt>
                  <dd className="whitespace-pre-line">{unit.notes}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
            <CardDescription>{t("historyDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <EmptyState title={t("historyEmpty")} />
            ) : (
              <div className="overflow-x-auto">
                <Table data-testid="equipment-history">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t("col.job")}</TableHead>
                      <TableHead scope="col">{t("col.serviceType")}</TableHead>
                      <TableHead scope="col">{t("col.date")}</TableHead>
                      <TableHead scope="col">{t("col.technicians")}</TableHead>
                      <TableHead scope="col">{t("col.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>
                          <Link
                            href={`/jobs/${formatJobNumber(h.number)}`}
                            className="text-primary font-mono text-xs hover:underline"
                          >
                            {formatJobNumber(h.number)}
                          </Link>
                          <span className="block text-sm">{h.title}</span>
                          <PriorityBadge priority={h.priority} />
                        </TableCell>
                        <TableCell className="text-sm">{h.serviceTypeName ?? "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDate(h.completedAt ?? h.scheduledStart ?? h.createdAt, tz)}
                        </TableCell>
                        <TableCell className="text-sm">{h.technicians.join(", ") || "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={h.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
