import { NotFoundError, portalBilling } from "@fieldops/core";
import { renderInvoicePdf } from "@fieldops/documents";
import { invoiceDocument } from "@/server/documents";
import { runPortal } from "@/server/portal/session";
import { pdfResponse } from "@/server/reports/document";

// GET /portal/<slug>/invoices/<id>/pdf (POR-04): the signed-in customer downloads one of their invoices. Another
// customer's invoice or a draft answers 404. Rendered after the data transaction.

export async function GET(_req: Request, route: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await route.params;
  try {
    const doc = await runPortal(slug, async (ctx) =>
      invoiceDocument(ctx, await portalBilling.portalInvoiceView(ctx.store, ctx.portal, id)),
    );
    return pdfResponse(await renderInvoicePdf(doc), `${doc.number}.pdf`, true);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
