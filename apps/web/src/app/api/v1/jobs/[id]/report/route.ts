import { NotFoundError, reports } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { ApiProblem } from "@/server/api/problem";
import { reportEtag, toReportDto } from "@/server/api/serialize-reports";

/** The job's service report (AI-03). 404 until the job has been completed. */
export const GET = apiRoute<{ id: string }>(async ({ params, ctx }) => {
  const { report } = await reports.getReport(ctx, params.id);
  if (!report) throw new NotFoundError("Service report");
  return { body: toReportDto(report), headers: { ETag: reportEtag(report.version) } };
});

/** Parses `If-Match: "r3"` into a report version. */
function ifMatch(req: Request): number | undefined {
  const header = req.headers.get("if-match");
  if (header === null) return undefined;
  const m = /^(?:W\/)?"r(\d+)"$/.exec(header.trim());
  if (!m)
    throw new ApiProblem(412, "precondition_failed", 'If-Match must be an ETag from this API, such as "r3"');
  return Number(m[1]);
}

/** Edits the report. Changing a sent report takes it back to draft until it is sent again. */
export const PATCH = apiRoute<{ id: string }>(async ({ req, params, body, ctx }) => {
  const report = await reports.updateReport(ctx, params.id, body ?? {}, ifMatch(req));
  return { body: toReportDto(report), headers: { ETag: reportEtag(report.version) } };
});
