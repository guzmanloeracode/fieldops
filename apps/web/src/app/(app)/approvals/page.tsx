import { can, expenses, formatMoney, organization } from "@fieldops/core";
import { intlLocale } from "@/lib/format";
import { EXPENSE_KINDS, EXPENSE_STATUSES, expenseListQuerySchema } from "@fieldops/shared";
import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { NativeSelect } from "@/components/app/native-select";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireActor, runService } from "@/server/context";
import { toExpenseRows } from "./_components/to-row";
import { ApprovalsList } from "./approvals-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("approvals") };
}

const PAGE_SIZE = 25;
type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** EXP-03: the approvals inbox for owners, admins and dispatchers. Filters live in the URL. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireActor();
  if (!can(actor, "expenses.approve", { belowDispatcherThreshold: true })) notFound();
  const t = await getTranslations("expenses");
  const locale = await getLocale();
  const sp = await searchParams;

  // Pending is the default view; "all" shows every status.
  const statusParam = first(sp.status) ?? "pending";
  const raw = {
    status: statusParam === "all" ? undefined : statusParam,
    kind: first(sp.kind),
    technician: first(sp.technician),
    from: first(sp.from),
    to: first(sp.to),
    page: first(sp.page) ?? "1",
    limit: PAGE_SIZE,
  };
  const parsed = expenseListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : expenseListQuerySchema.parse({ status: "pending", limit: PAGE_SIZE, page: 1 });
  const page = query.page ?? 1;

  const data = await runService(async (ctx) => {
    const [result, members, org, pendingCount] = await Promise.all([
      expenses.listExpenses(ctx, query),
      organization.listMembers(ctx),
      ctx.store.organization.get(),
      ctx.store.expenses.countPending(),
    ]);
    const receipts = await expenses.receiptLinks(ctx, result.rows);
    return { result, members, org, receipts, pendingCount };
  }, actor);
  const rows = toExpenseRows(data.result.rows, {
    actor,
    locale,
    settings: data.org.settings,
    receipts: data.receipts,
    canWork: () => can(actor, "jobs.work", { assigned: false }),
  });
  const currency = data.org.currency;
  const limitNote =
    actor.role === "dispatcher"
      ? t("inbox.limitNote", {
          amount: formatMoney(
            { amountMinor: data.org.settings.approval.dispatcherLimitMinor, currency },
            intlLocale(locale),
          ),
        })
      : null;
  const filtered = Boolean(
    statusParam !== "pending" || query.kind || query.technician || query.from || query.to,
  );
  const requesters = data.members.filter((m) => m.role === "technician" || m.id === query.technician);

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (statusParam !== "pending") params.set("status", statusParam);
    if (query.kind) params.set("kind", query.kind);
    if (query.technician) params.set("technician", query.technician);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/approvals?${s}` : "/approvals";
  };

  return (
    <>
      <PageHeader
        title={t("inbox.title")}
        description={
          <>
            {t("inbox.description")}{" "}
            <span data-testid="pending-summary">{t("inbox.pendingCount", { count: data.pendingCount })}</span>
          </>
        }
      />
      {limitNote ? (
        <p className="bg-muted mb-4 rounded-md px-3 py-2 text-sm" data-testid="limit-note">
          {limitNote}
        </p>
      ) : null}

      <form
        method="get"
        action="/approvals"
        className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-[auto_auto_auto_auto_auto_auto] lg:items-end"
        role="search"
      >
        <div className="space-y-1.5">
          <Label htmlFor="approvals-status" className="text-muted-foreground text-xs">
            {t("inbox.filters.status")}
          </Label>
          <NativeSelect id="approvals-status" name="status" defaultValue={statusParam} className="lg:w-36">
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
            <option value="all">{t("inbox.filters.allStatuses")}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="approvals-kind" className="text-muted-foreground text-xs">
            {t("inbox.filters.kind")}
          </Label>
          <NativeSelect id="approvals-kind" name="kind" defaultValue={query.kind ?? ""} className="lg:w-32">
            <option value="">{t("inbox.filters.allKinds")}</option>
            {EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="col-span-2 space-y-1.5 lg:col-span-1">
          <Label htmlFor="approvals-technician" className="text-muted-foreground text-xs">
            {t("inbox.filters.technician")}
          </Label>
          <NativeSelect
            id="approvals-technician"
            name="technician"
            defaultValue={query.technician ?? ""}
            className="lg:w-44"
          >
            <option value="">{t("inbox.filters.allTechnicians")}</option>
            {requesters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="approvals-from" className="text-muted-foreground text-xs">
            {t("inbox.filters.from")}
          </Label>
          <Input
            id="approvals-from"
            name="from"
            type="date"
            defaultValue={query.from ?? ""}
            className="lg:w-40"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="approvals-to" className="text-muted-foreground text-xs">
            {t("inbox.filters.to")}
          </Label>
          <Input id="approvals-to" name="to" type="date" defaultValue={query.to ?? ""} className="lg:w-40" />
        </div>
        <div className="col-span-2 flex gap-2 lg:col-span-1">
          <Button type="submit" variant="secondary">
            {t("inbox.filters.apply")}
          </Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href="/approvals">{t("inbox.filters.clear")}</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck />}
          title={filtered ? t("inbox.emptyFiltered") : t("inbox.empty")}
          description={filtered ? undefined : t("inbox.emptyNone")}
        />
      ) : (
        <div className="rounded-xl border">
          <ApprovalsList rows={rows} />
          <div className="border-t px-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data.result.total ?? 0}
              buildHref={buildHref}
            />
          </div>
        </div>
      )}
    </>
  );
}
