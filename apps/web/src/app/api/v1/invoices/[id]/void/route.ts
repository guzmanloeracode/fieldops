import { invoices } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toInvoiceDto } from "@/server/api/serialize-billing";

/** Voids an invoice without payments, with a reason. */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const invoice = await invoices.voidInvoice(ctx, params.id, body);
  return { body: toInvoiceDto(invoice) };
});
