import { invoices } from "@fieldops/core";
import { apiRoute, ifMatchVersion, jobEtag } from "@/server/api/handler";
import { toInvoiceDto } from "@/server/api/serialize-billing";

type Params = { id: string };

export const GET = apiRoute<Params>(async ({ req, params, ctx }) => {
  const invoice = await invoices.getInvoice(ctx, params.id);
  const etag = jobEtag(invoice.version);
  if (req.headers.get("if-none-match") === etag) return { status: 304, headers: { ETag: etag } };
  return { body: toInvoiceDto(invoice), headers: { ETag: etag } };
});

/** Edits a draft invoice. */
export const PATCH = apiRoute<Params>(async ({ req, params, body, ctx }) => {
  const invoice = await invoices.updateInvoice(ctx, params.id, body ?? {}, ifMatchVersion(req));
  return { body: toInvoiceDto(invoice), headers: { ETag: jobEtag(invoice.version) } };
});
