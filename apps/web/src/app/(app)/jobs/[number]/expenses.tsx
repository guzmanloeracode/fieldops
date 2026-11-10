import { can, expenses, isOpen } from "@fieldops/core";
import { getLocale } from "next-intl/server";
import type { JobStatus } from "@fieldops/shared";
import { requireActor, runService } from "@/server/context";
import { toExpenseRows } from "../../approvals/_components/to-row";
import { ExpensesPanel } from "./expenses-panel";

/**
 * The job page's "Parts and expenses" section. It loads its own data so the page only renders it; technicians
 * only reach it for jobs assigned to them (the core service reports other jobs as not found).
 */
export async function JobExpenses({
  jobId,
  status,
  assigned,
}: {
  jobId: string;
  status: JobStatus;
  assigned: boolean;
}) {
  const actor = await requireActor();
  const data = await runService(async (ctx) => {
    const [rows, org] = await Promise.all([
      expenses.listJobExpenses(ctx, jobId),
      ctx.store.organization.get(),
    ]);
    const receipts = await expenses.receiptLinks(ctx, rows);
    return { rows, org, receipts };
  }, actor);
  const canWork = can(actor, "jobs.work", { assigned });
  const rows = toExpenseRows(data.rows, {
    actor,
    locale: await getLocale(),
    settings: data.org.settings,
    receipts: data.receipts,
    canWork: () => canWork,
  });
  return (
    <ExpensesPanel
      jobId={jobId}
      rows={rows}
      currency={data.org.currency}
      canRequest={isOpen(status) && can(actor, "expenses.request", { assigned })}
      autoApproveBelowMinor={data.org.settings.approval.autoApproveBelowMinor}
      totals={expenses.summarizeExpenses(data.rows)}
    />
  );
}
