"use server";
import { formatJobNumber, reports } from "@fieldops/core";
import type { ReportUpdateInput } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { action, requireActor, runService } from "@/server/context";
import { aiGuard, txRunner } from "@/server/ai";
import { renderReportPdf } from "@/server/reports/document";
import { loadReportPhotos } from "@/server/reports/files";
import { reportModel, reportSendDeps, runWithTx } from "@/server/reports/service";

// Service report actions on the job page (AI-03). The office and the job's technicians; the core checks it.

const refresh = (jobNumber: number) => revalidatePath(`/jobs/${formatJobNumber(jobNumber)}`);

export async function startReportAction(jobId: string) {
  return action(async () => {
    const report = await runService((ctx) => reports.startReport(ctx, jobId));
    const { job } = await runService((ctx) => reports.getReport(ctx, jobId));
    refresh(job.number);
    return { id: report.id };
  });
}

export async function saveReportAction(jobId: string, input: ReportUpdateInput, version: number) {
  return action(async () => {
    const report = await runService((ctx) => reports.updateReport(ctx, jobId, input, version));
    const { job } = await runService((ctx) => reports.getReport(ctx, jobId));
    refresh(job.number);
    return { version: report.version, status: report.status };
  });
}

/** "Draft with AI" and "Regenerate": two short transactions with the model call between them. */
export async function draftReportAction(jobId: string) {
  return action(async () => {
    const actor = await requireActor();
    const result = await reports.draftReport(
      txRunner(actor),
      reportModel,
      jobId,
      await aiGuard(),
      loadReportPhotos,
    );
    const { job } = await runService((ctx) => reports.getReport(ctx, jobId), actor);
    refresh(job.number);
    return { status: result.status };
  });
}

/** Renders the PDF first, so a report that can't be built is never announced to the customer. */
export async function sendReportAction(jobId: string, to: string) {
  return action(async () => {
    const actor = await requireActor();
    const data = await runService((ctx) => reports.reportDocument(ctx, jobId), actor);
    await renderReportPdf(data);
    const sent = await runWithTx(
      (ctx, tx) => reports.sendReport(ctx, jobId, { to }, reportSendDeps(tx, actor.organizationId)),
      actor,
    );
    refresh(data.job.number);
    return { sentTo: sent.report.sentTo };
  });
}
