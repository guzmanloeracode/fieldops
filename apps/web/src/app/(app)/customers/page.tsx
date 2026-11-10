import { can, customers } from "@fieldops/core";
import { customerListQuerySchema, CUSTOMER_TYPES } from "@fieldops/shared";
import { Building2, Plus, Search, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { NativeSelect } from "@/components/app/native-select";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { listCustomerTags } from "./queries";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 25;
const SORTS = ["name", "-name", "-created_at", "created_at"] as const;

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireActor();
  const t = await getTranslations("customers");
  const sp = await searchParams;

  const raw = {
    q: first(sp.q),
    type: first(sp.type),
    tag: first(sp.tag),
    sort: first(sp.sort),
    page: first(sp.page) ?? "1",
    limit: PAGE_SIZE,
  };
  const parsed = customerListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : customerListQuerySchema.parse({ limit: PAGE_SIZE, page: 1 });

  const [result, tags] = await Promise.all([
    runService((ctx) => customers.listCustomers(ctx, query), actor),
    listCustomerTags(actor.organizationId),
  ]);
  const page = query.page ?? 1;
  const filtered = Boolean(query.q || query.type || query.tag);
  const canCreate = can(actor, "customers.create");

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.type) params.set("type", query.type);
    if (query.tag) params.set("tag", query.tag);
    if (query.sort !== "name") params.set("sort", query.sort);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/customers?${s}` : "/customers";
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={actor.role === "technician" ? t("technicianNote") : t("description")}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/customers/new">
                <Plus /> {t("new")}
              </Link>
            </Button>
          ) : null
        }
      />

      <form method="get" action="/customers" className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end" role="search">
        <div className="space-y-1.5">
          <Label htmlFor="customer-q" className="sr-only">
            {t("searchLabel")}
          </Label>
          <div className="relative">
            <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input id="customer-q" name="q" type="search" defaultValue={query.q ?? ""} placeholder={t("search")} className="pl-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-type" className="text-muted-foreground text-xs">
            {t("filters.type")}
          </Label>
          <NativeSelect id="customer-type" name="type" defaultValue={query.type ?? ""} className="sm:w-40">
            <option value="">{t("filters.allTypes")}</option>
            {CUSTOMER_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`type.${v}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-tag" className="text-muted-foreground text-xs">
            {t("filters.tag")}
          </Label>
          <NativeSelect id="customer-tag" name="tag" defaultValue={query.tag ?? ""} className="sm:w-44">
            <option value="">{t("filters.allTags")}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-sort" className="text-muted-foreground text-xs">
            {t("filters.sort")}
          </Label>
          <NativeSelect id="customer-sort" name="sort" defaultValue={query.sort} className="sm:w-40">
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            {t("filters.apply")}
          </Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href="/customers">{t("filters.clear")}</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={t("empty.title")}
          description={filtered ? t("empty.filtered") : t("empty.none")}
          action={
            canCreate && !filtered ? (
              <Button asChild>
                <Link href="/customers/new">
                  <Plus /> {t("new")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.contact")}</TableHead>
                <TableHead className="text-right">{t("columns.sites")}</TableHead>
                <TableHead className="text-right">{t("columns.openJobs")}</TableHead>
                <TableHead>{t("columns.lastJob")}</TableHead>
                <TableHead>{t("columns.tags")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-64">
                    <Link href={`/customers/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      {c.type === "commercial" ? (
                        <Building2 aria-hidden className="text-muted-foreground size-4 shrink-0" />
                      ) : (
                        <User aria-hidden className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <span className="truncate">{c.name}</span>
                    </Link>
                    <span className="text-muted-foreground ml-6 block text-xs">{t(`type.${c.type}`)}</span>
                  </TableCell>
                  <TableCell className="max-w-56">
                    {c.primaryContact ? (
                      <>
                        <span className="block truncate text-sm">{c.primaryContact.name}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {c.primaryContact.email ?? c.primaryContact.phone ?? ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.siteCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.openJobCount}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{formatDate(c.lastJobAt, actor.organization.timezone)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={result.total ?? 0} buildHref={buildHref} />
          </div>
        </div>
      )}
    </>
  );
}
