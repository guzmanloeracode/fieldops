"use client";
import { formatMoney } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";
import { Check, CheckCheck, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { decideExpenseAction, markExpenseUsedAction } from "../../approvals/actions";
import type { ExpenseRow } from "../../approvals/_components/expense-row";
import { ExpenseSummary } from "../../approvals/_components/expense-summary";
import { RejectDialog } from "../../approvals/_components/reject-dialog";
import { RequestExpenseDialog } from "./request-expense-dialog";

/** "Parts and expenses" on the job page (EXP-01, EXP-02, TEC-03). */
export function ExpensesPanel({
  jobId,
  rows,
  currency,
  canRequest,
  autoApproveBelowMinor,
  totals,
}: {
  jobId: string;
  rows: ExpenseRow[];
  currency: Currency;
  canRequest: boolean;
  autoApproveBelowMinor: number;
  totals: { approvedMinor: number; pendingMinor: number; pendingCount: number };
}) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency });

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) => {
    setBusy(id);
    startTransition(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) {
        toast.error(r.error?.message ?? "");
        return;
      }
      setRejecting(null);
      toast.success(done);
      router.refresh();
    });
  };

  return (
    <Card data-testid="job-expenses">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {t("section.title")} <span className="text-muted-foreground font-normal">({rows.length})</span>
          </CardTitle>
          {rows.length ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              {[
                totals.approvedMinor
                  ? t("section.approvedTotal", { amount: money(totals.approvedMinor) })
                  : null,
                totals.pendingCount
                  ? t("section.pendingTotal", { amount: money(totals.pendingMinor) })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        {canRequest ? (
          <RequestExpenseDialog
            jobId={jobId}
            currency={currency}
            autoApproveBelowMinor={autoApproveBelowMinor}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("section.empty")}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start"
                data-testid="expense-row"
              >
                <ExpenseSummary row={row} />
                {row.canDecide || row.canMarkUsed ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {row.canDecide ? (
                      <>
                        <Button
                          size="sm"
                          className="min-h-10"
                          disabled={pending}
                          data-testid="expense-approve"
                          onClick={() =>
                            run(
                              row.id,
                              () => decideExpenseAction(row.id, { decision: "approve" }),
                              t("approved"),
                            )
                          }
                        >
                          {busy === row.id && !rejecting ? <Loader2 className="animate-spin" /> : <Check />}
                          {t("approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-10"
                          disabled={pending}
                          data-testid="expense-reject"
                          onClick={() => setRejecting(row.id)}
                        >
                          <X /> {t("reject")}
                        </Button>
                      </>
                    ) : null}
                    {row.canMarkUsed ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        disabled={pending}
                        data-testid="expense-mark-used"
                        onClick={() => run(row.id, () => markExpenseUsedAction(row.id), t("markedUsed"))}
                      >
                        {busy === row.id ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                        {t("markUsed")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <RejectDialog
        open={rejecting !== null}
        count={1}
        pending={pending}
        onOpenChange={(o) => !o && setRejecting(null)}
        onReject={(comment) => {
          const id = rejecting;
          if (id) run(id, () => decideExpenseAction(id, { decision: "reject", comment }), t("rejected"));
        }}
      />
    </Card>
  );
}
