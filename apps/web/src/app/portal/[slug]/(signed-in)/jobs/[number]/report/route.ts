import { NotFoundError, parseJobNumber, reports } from "@fieldops/core";
import { pdfResponse, renderReportPdf, reportFileName } from "@/server/reports/document";
import { runPortal } from "@/server/portal/session";

// GET /portal/<slug>/jobs/<number>/report (POR-04): the signed-in customer downloads the service report of one of
// their jobs, once it has been sent. Anything else answers 404. Rendered after the data transaction.

export async function GET(_req: Request, route: { params: Promise<{ slug: string; number: string }> }) {
  const { slug, number } = await route.params;
  const n = parseJobNumber(number);
  try {
    if (!n) throw new NotFoundError("Job");
    const data = await runPortal(slug, (ctx) => reports.portalReportDocument(ctx, n));
    return pdfResponse(await renderReportPdf(data), reportFileName(data), true);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
