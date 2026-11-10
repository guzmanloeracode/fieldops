import { renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { InvoicePdf, QuotePdf } from "./billing";
import { ServiceReportPdf } from "./report";
import { registerFonts } from "./theme";
import type { InvoiceDocument, QuoteDocument, ServiceReportDocument } from "./types";

export * from "./types";
export { documentLabels, formatAmount, formatDate, type DocumentLabels } from "./labels";
export { MAX_REPORT_PHOTOS } from "./report";

// Branded PDFs for quotes, invoices and service reports (FIN-04). Callers build the view models in types.ts from
// their records; the renderers never touch the database. Labels follow the document's language (en or id), the
// letterhead uses the organization's logo or a monogram in its brand color, and long tables continue on the next
// page under a repeated header.

async function render(element: ReactElement): Promise<Uint8Array> {
  registerFonts();
  // renderToBuffer is typed for <Document> elements; each layout returns one.
  return new Uint8Array(await renderToBuffer(element as Parameters<typeof renderToBuffer>[0]));
}

export function renderQuotePdf(doc: QuoteDocument): Promise<Uint8Array> {
  return render(<QuotePdf doc={doc} />);
}

export function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  return render(<InvoicePdf doc={doc} />);
}

export function renderServiceReportPdf(doc: ServiceReportDocument): Promise<Uint8Array> {
  return render(<ServiceReportPdf doc={doc} />);
}
