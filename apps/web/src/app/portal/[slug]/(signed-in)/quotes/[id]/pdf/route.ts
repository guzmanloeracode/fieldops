import { NotFoundError, portalBilling } from "@fieldops/core";
import { renderQuotePdf } from "@fieldops/documents";
import { quoteDocument } from "@/server/documents";
import { runPortal } from "@/server/portal/session";
import { pdfResponse } from "@/server/reports/document";

// GET /portal/<slug>/quotes/<id>/pdf (POR-04): the signed-in customer downloads one of their quotes. Another
// customer's quote or a draft answers 404. Rendered after the data transaction.

export async function GET(_req: Request, route: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await route.params;
  try {
    const doc = await runPortal(slug, async (ctx) =>
      quoteDocument(ctx, await portalBilling.portalQuoteView(ctx.store, ctx.portal, id)),
    );
    return pdfResponse(await renderQuotePdf(doc), `${doc.number}.pdf`, true);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
