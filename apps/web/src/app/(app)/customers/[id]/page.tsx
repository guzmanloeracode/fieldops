import { can, customers, formatJobNumber, jobs, NotFoundError, organization } from "@fieldops/core";
import { jobListQuerySchema, type Address } from "@fieldops/shared";
import { Building2, ExternalLink, KeyRound, Mail, MapPin, Phone, Plus, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { DeleteCustomerButton } from "./delete-customer-button";
import { EditCustomerDialog } from "./edit-customer-dialog";
import { SiteDialog } from "./site-dialog";

export const metadata: Metadata = { title: "Customer" };

function AddressLines({ address }: { address: Address }) {
  return (
    <address className="text-sm not-italic">
      {address.line1}
      {address.line2 ? `, ${address.line2}` : ""}
      <br />
      {[address.city, address.region, address.postal_code].filter(Boolean).join(", ")} · {address.country}
    </address>
  );
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await requireActor();
  const t = await getTranslations("customers");
  const tz = actor.organization.timezone;

  const data = await runService(async (ctx) => {
    const detail = await customers.getCustomerDetail(ctx, id);
    const [recent, org] = await Promise.all([
      jobs.listJobs(ctx, jobListQuerySchema.parse({ customer: id, sort: "-created_at", limit: 8 })),
      organization.getOrganization(ctx),
    ]);
    return { ...detail, recent: recent.rows, country: org.country };
  }, actor).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });

  const { customer, contacts, sites, stats } = data;
  const canUpdate = can(actor, "customers.update");
  const canDelete = can(actor, "customers.delete");
  const canCreateJob = can(actor, "jobs.create");

  const statItems = [
    { label: t("detail.stats.jobs"), value: stats.jobCount.toLocaleString("en-US") },
    { label: t("detail.stats.open"), value: stats.openJobCount.toLocaleString("en-US") },
    { label: t("detail.stats.completed"), value: stats.completedJobCount.toLocaleString("en-US") },
    { label: t("detail.stats.lastJob"), value: formatDate(stats.lastJobAt, tz) },
  ];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/customers" className="hover:underline">
            {t("detail.back")}
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            {customer.type === "commercial" ? (
              <Building2 aria-hidden className="text-muted-foreground size-6" />
            ) : (
              <User aria-hidden className="text-muted-foreground size-6" />
            )}
            {customer.name}
          </span>
        }
        description={`${t(`type.${customer.type}`)} · ${t("detail.since", { date: formatDate(customer.createdAt, tz) })}`}
        actions={
          <>
            {canCreateJob ? (
              <Button asChild>
                <Link href={`/jobs/new?customer=${customer.id}`}>
                  <Plus /> {t("detail.newJob")}
                </Link>
              </Button>
            ) : null}
            {canUpdate ? (
              <EditCustomerDialog
                defaultCountry={data.country}
                customer={{
                  id: customer.id,
                  type: customer.type,
                  name: customer.name,
                  tags: customer.tags,
                  notes: customer.notes,
                  billingAddress: customer.billingAddress,
                }}
              />
            ) : null}
            {canDelete ? <DeleteCustomerButton id={customer.id} name={customer.name} /> : null}
          </>
        }
      />

      {customer.tags.length ? (
        <div className="-mt-3 mb-6 flex flex-wrap gap-1.5">
          {customer.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statItems.map((s) => (
          <div key={s.label} className="bg-card rounded-xl border p-4">
            <dt className="text-muted-foreground text-xs">{s.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
        <div className="bg-card col-span-2 rounded-xl border p-4 sm:col-span-1">
          <dt className="text-muted-foreground text-xs">{t("detail.stats.ltv")}</dt>
          <dd className="mt-1 text-lg font-semibold">—</dd>
          <dd className="text-muted-foreground text-xs">{t("detail.stats.ltvNote")}</dd>
        </div>
      </dl>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>{t("detail.sites")}</CardTitle>
              {canUpdate ? <SiteDialog customerId={customer.id} defaultCountry={data.country} /> : null}
            </CardHeader>
            <CardContent>
              {sites.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("detail.noSites")}</p>
              ) : (
                <ul className="divide-y">
                  {sites.map((s) => (
                    <li key={s.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                      <MapPin aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium">{s.label}</p>
                        <AddressLines address={s.address} />
                        {s.accessNotes ? (
                          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                            <KeyRound aria-hidden className="mt-0.5 size-3 shrink-0" />
                            <span>
                              <span className="sr-only">{t("detail.access")}: </span>
                              {s.accessNotes}
                            </span>
                          </p>
                        ) : null}
                        {s.onsiteContactName ? (
                          <p className="text-muted-foreground text-xs">
                            {t("detail.onsite")}: {s.onsiteContactName}
                            {s.onsiteContactPhone ? ` · ${s.onsiteContactPhone}` : ""}
                          </p>
                        ) : null}
                        {s.latitude !== null && s.longitude !== null ? (
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=16/${s.latitude}/${s.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                          >
                            {t("detail.openMap")} <ExternalLink aria-hidden className="size-3" />
                          </a>
                        ) : null}
                      </div>
                      {canUpdate ? (
                        <SiteDialog
                          customerId={customer.id}
                          defaultCountry={data.country}
                          site={{
                            id: s.id,
                            label: s.label,
                            address: s.address,
                            latitude: s.latitude,
                            longitude: s.longitude,
                            access_notes: s.accessNotes,
                            onsite_contact_name: s.onsiteContactName,
                            onsite_contact_phone: s.onsiteContactPhone,
                          }}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>{t("detail.recentJobs")}</CardTitle>
              {data.recent.length ? (
                <Button asChild variant="link" size="sm" className="px-0">
                  <Link href={`/jobs?customer=${customer.id}`}>{t("detail.viewAllJobs")}</Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {data.recent.length === 0 ? (
                <EmptyState title={t("detail.noJobs")} />
              ) : (
                <ul className="divide-y">
                  {data.recent.map((j) => (
                    <li
                      key={j.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                    >
                      <Link
                        href={`/jobs/${formatJobNumber(j.number)}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {formatJobNumber(j.number)}
                      </Link>
                      <Link
                        href={`/jobs/${formatJobNumber(j.number)}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                      >
                        {j.title}
                      </Link>
                      <PriorityBadge priority={j.priority} />
                      <StatusBadge status={j.status} />
                      <span className="text-muted-foreground w-full text-xs sm:w-auto">
                        {formatDateTime(j.scheduledStart ?? j.createdAt, tz)} · {j.site.label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.contacts")}</CardTitle>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("detail.noContacts")}</p>
              ) : (
                <ul className="space-y-4">
                  {contacts.map((c) => (
                    <li key={c.id} className="space-y-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {c.name}
                        {c.isPrimary ? (
                          <Badge variant="outline" className="font-normal">
                            {t("detail.primary")}
                          </Badge>
                        ) : null}
                      </p>
                      {c.role ? <p className="text-muted-foreground text-xs">{c.role}</p> : null}
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="text-primary flex items-center gap-1.5 text-sm hover:underline"
                        >
                          <Mail aria-hidden className="size-3.5" /> {c.email}
                        </a>
                      ) : null}
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                          className="text-primary flex items-center gap-1.5 text-sm hover:underline"
                        >
                          <Phone aria-hidden className="size-3.5" /> {c.phone}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("detail.billingAddress")}</CardTitle>
            </CardHeader>
            <CardContent>
              {customer.billingAddress ? (
                <AddressLines address={customer.billingAddress} />
              ) : (
                <p className="text-muted-foreground text-sm">{t("detail.noBillingAddress")}</p>
              )}
            </CardContent>
          </Card>

          {customer.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("detail.notes")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{customer.notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
