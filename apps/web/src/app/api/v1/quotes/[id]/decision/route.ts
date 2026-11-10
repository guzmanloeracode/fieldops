import { quotes } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toQuoteDto } from "@/server/api/serialize-billing";

/** Records the customer's decision on a sent quote; an approval creates a job. */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const quote = await quotes.decideQuote(ctx, params.id, body);
  return { body: toQuoteDto(quote) };
});
