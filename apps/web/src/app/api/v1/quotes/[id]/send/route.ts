import { quotes } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toQuoteDto } from "@/server/api/serialize-billing";
import { billingContext } from "@/server/billing";

/** Emails the quote to its contact (or `contact_id`) with a link to the customer portal. */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const quote = await quotes.sendQuote(billingContext(ctx), params.id, body ?? {});
  return { body: toQuoteDto(quote) };
});
