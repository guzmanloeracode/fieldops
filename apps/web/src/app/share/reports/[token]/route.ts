import { reports } from "@fieldops/core";
import { withStore } from "@fieldops/db";
import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { pdfResponse, renderReportPdf, reportFileName } from "@/server/reports/document";
import { verifyReportLink } from "@/server/reports/link";

// GET /share/reports/<token> (AI-03): the service report PDF behind the link in the "Job completed" email. It works
// without a portal sign-in: the signed token names the organization and the report and expires after
// REPORT_LINK_DAYS days. The report must still be "sent": one changed after sending shows a short page instead.

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function page(status: number, key: "invalid" | "expired" | "updating") {
  const t = await getTranslations("reports.share");
  const title = escape(t(`${key}.title`));
  const body = escape(t(`${key}.body`));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#0b1220;margin:0;padding:48px 16px}main{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.5;color:#334155;margin:0}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function GET(req: Request, route: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await route.params;
  const check = verifyReportLink(token);
  if (!check.ok) return page(check.reason === "expired" ? 410 : 404, check.reason);
  try {
    const data = await withStore(db, check.organizationId, (store) =>
      reports.linkedReportDocument(store, check.reportId),
    );
    if (data === null) return page(404, "invalid");
    if (data === "updating") return page(409, "updating");
    const download = new URL(req.url).searchParams.get("download") === "1";
    return pdfResponse(await renderReportPdf(data), reportFileName(data), download);
  } catch (err) {
    logger.error({ err }, "shared report failed");
    return new Response("Something went wrong.", { status: 500 });
  }
}
