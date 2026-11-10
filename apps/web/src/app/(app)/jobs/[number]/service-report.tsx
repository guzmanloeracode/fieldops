import { ai, reports } from "@fieldops/core";
import { requireActor, runService } from "@/server/context";
import { reportModel } from "@/server/reports/service";
import { ServiceReportPanel } from "./service-report-panel";

/**
 * The job page's "Service report" section (AI-03): the draft created when the job was completed, its AI status,
 * the text to edit, and preview, download and send. The office and the job's technicians; it loads its own data.
 */
export async function ServiceReport({ jobId, completed }: { jobId: string; completed: boolean }) {
  const actor = await requireActor();
  const data = await runService(async (ctx) => {
    const [view, org, used] = await Promise.all([
      reports.getReport(ctx, jobId),
      ctx.store.organization.get(),
      ctx.store.ai.countSince(ai.monthStart(ctx.now)),
    ]);
    const quotaLeft = used < org.settings.ai.monthlyQuota;
    return {
      view,
      aiAvailable: org.settings.ai.enabled && reportModel.provider !== "unavailable" && quotaLeft,
      timeZone: org.timezone,
    };
  }, actor);
  const { view } = data;
  if (!view.report && !completed) return null;
  const r = view.report;
  return (
    <ServiceReportPanel
      // A new version (saved, drafted) starts the form again from the saved text.
      key={r?.version ?? 0}
      jobId={view.job.id}
      canWrite={view.canWrite}
      aiAvailable={data.aiAvailable && view.canWrite}
      timeZone={data.timeZone}
      contacts={view.contacts}
      report={
        r
          ? {
              status: r.status,
              locale: r.locale,
              workPerformed: r.workPerformed ?? "",
              findings: r.findings ?? "",
              recommendations: r.recommendations ?? "",
              nextServiceDate: r.nextServiceDate ?? "",
              aiStatus: r.aiStatus,
              aiDrafted: r.aiDrafted,
              edited: r.editedBy !== null,
              sentAt: r.sentAt?.toISOString() ?? null,
              sentTo: r.sentTo,
              version: r.version,
            }
          : null
      }
    />
  );
}
