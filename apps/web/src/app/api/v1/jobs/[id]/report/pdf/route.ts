import { reports } from "@fieldops/core";
import { authenticate, problemResponse } from "@/server/api/handler";
import { internalProblem, problemFromError } from "@/server/api/problem";
import { runWithTx } from "@/server/reports/service";
import { pdfResponse, renderReportPdf, reportFileName } from "@/server/reports/document";
import { logger } from "@/server/logger";

// GET /api/v1/jobs/{id}/report/pdf (AI-03, FIN-04): the report as a PDF, in any status, for the office and the
// job's technicians. `?download=1` saves it instead of showing it. Not wrapped in apiRoute(): the data is read in
// one short transaction and the PDF is rendered after it.

export async function GET(req: Request, route: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  try {
    const actor = await authenticate(req);
    const { id } = await route.params;
    const data = await runWithTx((ctx) => reports.reportDocument(ctx, id), actor);
    const bytes = await renderReportPdf(data);
    return pdfResponse(bytes, reportFileName(data), url.searchParams.get("download") === "1");
  } catch (err) {
    const problem = problemFromError(err, url.pathname);
    if (problem) return problemResponse(problem.body, requestId, problem.headers);
    logger.error({ err, requestId }, "report pdf failed");
    return problemResponse(internalProblem(url.pathname), requestId);
  }
}
