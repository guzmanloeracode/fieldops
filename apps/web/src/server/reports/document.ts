import "server-only";
import type { ReportDocumentData } from "@fieldops/core";
import { formatJobNumber } from "@fieldops/core";
import {
  MAX_REPORT_PHOTOS,
  renderServiceReportPdf,
  type DocumentParty,
  type ServiceReportDocument,
} from "@fieldops/documents";
import type { Address } from "@fieldops/shared";
import { pdfImage } from "./files";

// The service report PDF (AI-03, FIN-04): builds the documents package's view model from what the core loaded,
// reads the photos and the signature, and renders it. Callers load the data in a transaction and render after
// it, so no database connection waits on the renderer.

/** "1 Main St", "Suite 2", "Austin, TX 78701". */
export function addressLines(a: Address | null): string[] {
  if (!a) return [];
  const city = [a.city, [a.region, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2, city].filter((l): l is string => Boolean(l && l.trim()));
}

export async function buildReportDocument(data: ReportDocumentData): Promise<ServiceReportDocument> {
  const { organization: org, report, job, customer, site, primaryContact } = data;
  const [photos, signature] = await Promise.all([
    Promise.all(
      data.photos.slice(0, MAX_REPORT_PHOTOS * 2).map(async (a) => ({ a, image: await pdfImage(a) })),
    ),
    pdfImage(data.signature),
  ]);
  const contactLines = primaryContact
    ? [
        primaryContact.name !== customer.name ? primaryContact.name : null,
        primaryContact.phone,
        primaryContact.email,
      ].filter((l): l is string => Boolean(l))
    : [];
  const customerParty: DocumentParty = {
    name: customer.name,
    lines: [...addressLines(customer.billingAddress), ...contactLines],
  };
  return {
    locale: report.locale,
    currency: org.currency,
    brand: {
      name: org.name,
      // The organization's logo isn't stored as a file yet; the letterhead draws a monogram in the brand color.
      logo: null,
      brandColor: org.brandColor,
      addressLines: addressLines(org.address),
      email: null,
      phone: null,
      timeZone: org.timezone,
    },
    jobNumber: formatJobNumber(job.number),
    title: job.title,
    customer: customerParty,
    site: { name: site.label, lines: addressLines(site.address) },
    completedOn: data.completedOn,
    technicians: data.technicians,
    workPerformed: report.workPerformed ?? "",
    findings: report.findings,
    recommendations: report.recommendations,
    nextServiceDate: report.nextServiceDate,
    checklist: data.checklist,
    partsUsed: data.parts.map((p) => ({ description: p.description, quantity: p.quantity, unit: null })),
    photos: photos
      .filter((p): p is { a: (typeof data.photos)[number]; image: Uint8Array } => p.image !== null)
      .map((p) => ({ tag: p.a.tag, caption: p.a.caption, image: p.image })),
    signature: signature ? { name: data.signature?.caption ?? null, image: signature } : null,
  };
}

/** "JOB-000123-service-report.pdf", or "JOB-000123-laporan-servis.pdf" for an Indonesian report. */
export function reportFileName(data: ReportDocumentData): string {
  const name = data.report.locale === "id" ? "laporan-servis" : "service-report";
  return `${formatJobNumber(data.job.number)}-${name}.pdf`;
}

export async function renderReportPdf(data: ReportDocumentData): Promise<Uint8Array> {
  return renderServiceReportPdf(await buildReportDocument(data));
}

/** A PDF response: shown in the browser, or saved with `download`. Never cached by shared caches. */
export function pdfResponse(bytes: Uint8Array, fileName: string, download = false): Response {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
