import { can, jobs, organization, views } from "@fieldops/core";
import { jobListQuerySchema } from "@fieldops/shared";
import { format } from "date-fns";
import { Briefcase, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { formatDateTime, inZone } from "@/lib/format";
import { attentionSla } from "@/lib/sla";
import { requireActor, runService } from "@/server/context";
import { JobFilters } from "../job-filters";
import { JobsTable, type JobRow } from "../jobs-table";
import { MyDay } from "../my-day";
import { SavedViews } from "../saved-views";
import { formatJobNumber } from "@fieldops/core";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("jobs") };
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const t = await getTranslations("jobs");
  const locale = await getLocale();
  const sp = await searchParams;
  const tz = actor.organization.timezone;
  const myDay = one(sp.view) === "my-day";
  if (myDay) return <MyDay actor={actor} />;
  const today = format(inZone(new Date(), tz), "yyyy-MM-dd");

  const raw = {
    q: one(sp.q) || undefined,
    status: one(sp.status) || undefined,
    priority: one(sp.priority) || undefined,
    technician: one(sp.technician) || undefined,
    service_type: one(sp.service_type) || undefined,
    customer: one(sp.customer) || undefined,
    from: myDay ? today : one(sp.from) || undefined,
    to: myDay ? today : one(sp.to) || undefined,
    date_field: one(sp.date_field) || undefined,
    unassigned: one(sp.unassigned) || undefined,
    revisit: one(sp.revisit) || undefined,
    needs_review: one(sp.needs_review) || undefined,
    sla: one(sp.sla) || undefined,
    sort: myDay ? "scheduled_start" : one(sp.sort) || undefined,
    limit: one(sp.limit) || 25,
    page: one(sp.page) || 1,
  };
  const parsed = jobListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : jobListQuerySchema.parse({ limit: 25, page: 1 });
  const office = can(actor, "jobs.update");
  const tsla = await getTranslations("sla");

  const data = await runService(async (ctx) => {
    const [page, members, serviceTypes, customer, savedViews] = await Promise.all([
      jobs.listJobs(ctx, query),
      office ? organization.listAssignableMembers(ctx) : Promise.resolve([]),
      organization.listServiceTypes(ctx),
      query.customer ? ctx.store.customers.get(query.customer) : Promise.resolve(null),
      views.listViews(ctx),
    ]);
    return {
      page,
      members,
      serviceTypes,
      customer,
      savedViews: savedViews.map((v) => ({
        id: v.id,
        name: v.name,
        query: v.query,
        shared: v.shared,
        ownerName: v.ownerName,
        canDelete: views.canDeleteView(ctx, v),
      })),
    };
  });

  const rows: JobRow[] = data.page.rows.map((j) => ({
    id: j.id,
    number: formatJobNumber(j.number),
    title: j.title,
    status: j.status,
    priority: j.priority,
    customer: j.customer.name,
    city: j.site.address.city,
    site: j.site.label,
    serviceType: j.serviceType?.name ?? null,
    assignees: j.assignees.map((a) => a.name),
    scheduledStart: j.scheduledStart?.toISOString() ?? null,
    scheduledEnd: j.scheduledEnd?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    needsReview: j.needsReview,
    sla: (() => {
      const a = attentionSla(j);
      return a
        ? {
            state: a.state,
            title: tsla("badgeTitle", {
              target: tsla(`target.${a.target}`),
              state: tsla(`state.${a.state}`).toLowerCase(),
              due: a.dueAt ? formatDateTime(a.dueAt, tz, locale) : "—",
            }),
          }
        : null;
    })(),
  }));

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v);
    if (val && k !== "page") params.set(k, val);
  }
  const buildHref = (page: number) => {
    const p = new URLSearchParams(params);
    p.set("page", String(page));
    return `/jobs?${p.toString()}`;
  };

  const filtered = Boolean(
    query.q ||
    query.status ||
    query.priority ||
    query.technician ||
    query.service_type ||
    query.customer ||
    query.from ||
    query.to ||
    query.unassigned ||
    query.revisit ||
    query.needs_review,
  );

  return (
    <div>
      <PageHeader
        title={myDay ? t("myDay") : t("title")}
        description={
          myDay
            ? t("myDayDescription")
            : data.customer
              ? t("forCustomer", { name: data.customer.name })
              : t("description")
        }
        actions={
          can(actor, "jobs.create") ? (
            <Button asChild>
              <Link href={query.customer ? `/jobs/new?customer=${query.customer}` : "/jobs/new"}>
                <Plus /> {t("newJob")}
              </Link>
            </Button>
          ) : null
        }
      />
      {!myDay ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <SavedViews views={data.savedViews} canShare={can(actor, "views.share")} />
        </div>
      ) : null}
      {!myDay ? (
        <JobFilters
          members={data.members.map((m) => ({ id: m.id, name: m.name }))}
          serviceTypes={data.serviceTypes.map((s) => ({ id: s.id, name: s.name }))}
          customer={data.customer ? { id: data.customer.id, name: data.customer.name } : null}
          showTechnician={office}
        />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Briefcase />}
          title={filtered ? t("emptyFiltered") : myDay ? t("emptyMyDay") : t("empty")}
          description={filtered ? t("emptyFilteredHint") : undefined}
          action={
            filtered && !myDay ? (
              <Button variant="outline" asChild>
                <Link href="/jobs">{t("clearFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <JobsTable
            rows={rows}
            sort={query.sort}
            timeZone={actor.organization.timezone}
            sortable={!myDay}
            bulk={
              office
                ? {
                    members: data.members.map((m) => ({ id: m.id, name: m.name })),
                    exportHref: `/jobs/export${params.size ? `?${params.toString()}` : ""}`,
                  }
                : undefined
            }
          />
          <Pagination
            page={query.page ?? 1}
            pageSize={query.limit}
            total={data.page.total ?? rows.length}
            buildHref={buildHref}
          />
        </>
      )}
    </div>
  );
}
