import { quotes } from "@fieldops/core";
import { renderQuotePdf } from "@fieldops/documents";
import { apiPdfRoute } from "@/server/api/pdf";
import { quoteDocument } from "@/server/documents";

export const dynamic = "force-dynamic";

/** The quote as a PDF (FIN-04). */
export const GET = apiPdfRoute<{ id: string }>(async ({ params, ctx }) => {
  const quote = await quotes.getQuote(ctx, params.id);
  const doc = await quoteDocument(ctx, quote);
  return async () => ({ bytes: await renderQuotePdf(doc), fileName: `${quote.number}.pdf` });
});
