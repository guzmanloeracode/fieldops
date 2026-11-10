import { reports } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { reportEtag, toReportDto } from "@/server/api/serialize-reports";
import { reportSendDeps } from "@/server/reports/service";

/** Emails the report's download link to one of the customer's contacts (AI-03, §8.7). */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx, tx, actor }) => {
  const { report, expiresAt } = await reports.sendReport(
    ctx,
    params.id,
    body,
    reportSendDeps(tx, actor.organizationId),
  );
  return {
    body: { report: toReportDto(report), link_expires_at: expiresAt.toISOString() },
    headers: { ETag: reportEtag(report.version) },
  };
});
