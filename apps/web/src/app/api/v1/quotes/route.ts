import { parseInput, quotes } from "@fieldops/core";
import { quoteListQuerySchema } from "@fieldops/shared";
import { apiRoute, jobEtag, queryObject } from "@/server/api/handler";
import { toQuoteDto, toQuoteSummaryDto } from "@/server/api/serialize-billing";

/** Quotes, newest first (FIN-02). Office roles. */
export const GET = apiRoute(async ({ url, ctx }) => {
  const query = parseInput(quoteListQuerySchema, queryObject(url));
  const page = await quotes.listQuotes(ctx, { ...query, page: undefined });
  return { body: { data: page.rows.map(toQuoteSummaryDto), next_cursor: page.nextCursor } };
});

export const POST = apiRoute(async ({ body, ctx }) => {
  const quote = await quotes.createQuote(ctx, body);
  return {
    status: 201,
    body: toQuoteDto(quote),
    headers: { Location: `/api/v1/quotes/${quote.id}`, ETag: jobEtag(quote.version) },
  };
});
