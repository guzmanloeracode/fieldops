import { invoices, parseInput } from "@fieldops/core";
import { invoiceListQuerySchema } from "@fieldops/shared";
import { apiRoute, jobEtag, queryObject } from "@/server/api/handler";
import { toInvoiceDto, toInvoiceSummaryDto } from "@/server/api/serialize-billing";

/** Invoices, newest first (FIN-03). Office roles. */
export const GET = apiRoute(async ({ url, ctx }) => {
  const query = parseInput(invoiceListQuerySchema, queryObject(url));
  const page = await invoices.listInvoices(ctx, { ...query, page: undefined });
  return { body: { data: page.rows.map(toInvoiceSummaryDto), next_cursor: page.nextCursor } };
});

/** A draft invoice for a completed job (lines prefilled unless given) or a customer. */
export const POST = apiRoute(async ({ body, ctx }) => {
  const invoice = await invoices.createInvoice(ctx, body);
  return {
    status: 201,
    body: toInvoiceDto(invoice),
    headers: { Location: `/api/v1/invoices/${invoice.id}`, ETag: jobEtag(invoice.version) },
  };
});
