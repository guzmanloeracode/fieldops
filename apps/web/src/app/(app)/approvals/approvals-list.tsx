"use client";
import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { decideExpenseAction, decideExpensesAction } from "./actions";
import type { ExpenseRow } from "./_components/expense-row";
import { ExpenseSummary } from "./_components/expense-summary";
import { RejectDialog } from "./_components/reject-dialog";

type Failure = { item: string; message: string };

/**
 * EXP-03: requests as cards (they work on a phone too), each with approve and reject, plus a selection for
 * bulk decisions. Requests the viewer can't decide (above a dispatcher's limit) can't be selected.
 */
export function ApprovalsList({ rows }: { rows: ExpenseRow[] }) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const selectable = useMemo(() => rows.filter((r) => r.canDecide).map((r) => r.id), [rows]);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const itemOf = (id: string) => rows.find((r) => r.id === id)?.item ?? id;

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const decide = (ids: string[], decision: "approve" | "reject", comment?: string) =>
    startTransition(async () => {
      const r =
        ids.length === 1
          ? await decideExpenseAction(ids[0]!, { decision, comment: comment ?? null }).then((x) =>
              x.ok
                ? { ok: true as const, data: [{ id: ids[0]!, ok: true as const }] }
                : { ok: true as const, data: [{ id: ids[0]!, ok: false as const, error: x.error }] },
            )
          : await decideExpensesAction({ ids, decision, comment: comment ?? null });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      const ok = r.data.filter((x) => x.ok).length;
      const failed = r.data.filter((x) => !x.ok);
      const verb =
        decision === "approve" ? t("status.approved").toLowerCase() : t("status.rejected").toLowerCase();
      const message = [
        t("inbox.bulkResult", { ok, decision: verb }),
        ...(failed.length ? [t("inbox.bulkFailed", { count: failed.length })] : []),
      ].join(", ");
      if (failed.length) toast.warning(message);
      else toast.success(message);
      setFailures(
        failed.map((f) => ({ item: itemOf(f.id), message: "error" in f && f.error ? f.error.message : "" })),
      );
      setSelected(new Set());
      setRejecting(null);
      router.refresh();
    });

  return (
    <div>
      <div className="bg-muted/40 flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <Checkbox
            checked={allSelected}
            disabled={selectable.length === 0}
            aria-label={t("inbox.selectAll")}
            onCheckedChange={(v) => setSelected(v ? new Set(selectable) : new Set())}
            data-testid="approvals-select-all"
          />
          <span aria-hidden>{t("inbox.selected", { count: selected.size })}</span>
        </label>
        {selected.size ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => decide([...selected], "approve")}
              data-testid="bulk-approve"
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              {t("inbox.approveSelected")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setRejecting([...selected])}
              data-testid="bulk-reject"
            >
              <X /> {t("inbox.rejectSelected")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("inbox.clearSelection")}
            </Button>
          </div>
        ) : null}
      </div>

      {failures.length ? (
        <div
          role="status"
          className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
        >
          <p className="font-medium">{t("inbox.failures")}</p>
          <ul className="mt-1 list-disc pl-5">
            {failures.map((f, i) => (
              <li key={i}>
                {f.item}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex gap-3 px-4 py-3" data-testid="approval-row">
            <div className="flex min-h-10 items-start pt-0.5">
              <Checkbox
                checked={selected.has(row.id)}
                disabled={!row.canDecide}
                aria-label={t("inbox.select", { item: row.item })}
                onCheckedChange={(v) => toggle(row.id, Boolean(v))}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
              <ExpenseSummary row={row} showJob />
              {row.status === "pending" ? (
                row.canDecide ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      className="min-h-10"
                      disabled={pending}
                      onClick={() => decide([row.id], "approve")}
                      data-testid="approval-approve"
                    >
                      <Check /> {t("approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-10"
                      disabled={pending}
                      onClick={() => setRejecting([row.id])}
                      data-testid="approval-reject"
                    >
                      <X /> {t("reject")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground shrink-0 text-sm" data-testid="above-limit">
                    {t("aboveLimit")}
                  </p>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <RejectDialog
        open={rejecting !== null}
        count={rejecting?.length ?? 1}
        pending={pending}
        onOpenChange={(o) => !o && setRejecting(null)}
        onReject={(comment) => rejecting && decide(rejecting, "reject", comment)}
      />
    </div>
  );
}
