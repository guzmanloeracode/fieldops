import { invoices } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toInvoiceDto } from "@/server/api/serialize-billing";
import { billingContext } from "@/server/billing";

/** Issues a draft (number, issue and due dates) and emails it, or emails an issued invoice again. */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const invoice = await invoices.sendInvoice(billingContext(ctx), params.id, body ?? {});
  return { body: toInvoiceDto(invoice) };
});
