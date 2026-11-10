import { invoices } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toInvoiceDto, toPaymentDto } from "@/server/api/serialize-billing";
import { billingContext } from "@/server/billing";

type Params = { id: string };

/** The invoice's payments, oldest first. */
export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  const invoice = await invoices.getInvoice(ctx, params.id);
  return { body: { data: invoice.payments.map(toPaymentDto), next_cursor: null } };
});

/** Records a manual payment (cash, bank transfer…), at most the balance; the invoice becomes paid when settled. */
export const POST = apiRoute<Params>(async ({ params, body, ctx }) => {
  const invoice = await invoices.recordPayment(billingContext(ctx), params.id, body);
  return { status: 201, body: toInvoiceDto(invoice) };
});
