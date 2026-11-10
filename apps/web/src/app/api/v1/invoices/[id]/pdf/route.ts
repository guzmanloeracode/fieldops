import { invoices } from "@fieldops/core";
import { renderInvoicePdf } from "@fieldops/documents";
import { apiPdfRoute } from "@/server/api/pdf";
import { invoiceDocument } from "@/server/documents";

export const dynamic = "force-dynamic";

/** The invoice as a PDF (FIN-04); a draft downloads as a preview. */
export const GET = apiPdfRoute<{ id: string }>(async ({ params, ctx }) => {
  const invoice = await invoices.getInvoice(ctx, params.id);
  const doc = await invoiceDocument(ctx, invoice);
  return async () => ({
    bytes: await renderInvoicePdf(doc),
    fileName: `${invoice.number ?? `draft-${invoice.id.slice(0, 8)}`}.pdf`,
  });
});
