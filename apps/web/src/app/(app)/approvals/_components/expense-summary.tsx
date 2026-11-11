"use client";
import { formatMoney } from "@fieldops/core";
import { intlLocale } from "@/lib/format";
import { CheckCheck, Receipt } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ExpenseRow } from "./expense-row";
import { ExpenseStatusBadge } from "./expense-status-badge";

export const formatQuantity = (q: number, locale?: string) =>
  q.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 });

/** The facts of one request: what, how much, who and why. Shared by the job page and the inbox. */
export function ExpenseSummary({ row, showJob = false }: { row: ExpenseRow; showJob?: boolean }) {
  const t = useTranslations("expenses");
  const locale = useLocale();
  const money = (minor: number) =>
    formatMoney({ amountMinor: minor, currency: row.currency }, intlLocale(locale));
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{row.item}</span>
        <span className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-xs">
          {t(`kind.${row.kind}`)}
        </span>
        <ExpenseStatusBadge status={row.status} label={t(`status.${row.status}`)} />
        {row.autoApproved ? <span className="text-muted-foreground text-xs">{t("autoApproved")}</span> : null}
        {row.usedAt ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCheck className="size-3.5" aria-hidden /> {t("used")}
          </span>
        ) : null}
      </div>
      <p className="text-sm">
        <span className="font-semibold tabular-nums" data-testid="expense-total">
          {money(row.totalMinor)}
        </span>{" "}
        <span className="text-muted-foreground tabular-nums">
          (
          {t("qtyTimesUnit", {
            quantity: formatQuantity(row.quantity, locale),
            unit: money(row.unitCostMinor),
          })}
          )
        </span>
        {row.supplier ? <span className="text-muted-foreground"> · {row.supplier}</span> : null}
      </p>
      {showJob ? (
        <p className="text-sm">
          <Link href={`/jobs/${row.job.number}`} className="font-mono text-xs underline underline-offset-2">
            {row.job.number}
          </Link>{" "}
          <span className="text-muted-foreground">{row.job.title}</span>
        </p>
      ) : null}
      <p className="text-sm">“{row.reason}”</p>
      <p className="text-muted-foreground text-xs">
        {row.requester ? t("requestedBy", { name: row.requester }) : null}
        {row.requester ? " · " : null}
        <time dateTime={row.createdAt}>{row.age}</time>
        {row.decidedBy ? <> · {t("decidedBy", { decision: row.status, name: row.decidedBy })}</> : null}
      </p>
      {row.decisionComment ? (
        <p className="text-muted-foreground border-l-2 pl-2 text-sm">{row.decisionComment}</p>
      ) : null}
      {row.receiptUrl ? (
        <a
          href={row.receiptUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
        >
          {row.receiptThumbUrl ? (
            <img src={row.receiptThumbUrl} alt="" className="size-10 rounded border object-cover" />
          ) : (
            <Receipt className="size-4" aria-hidden />
          )}
          {t("viewReceipt")}
        </a>
      ) : null}
    </div>
  );
}
