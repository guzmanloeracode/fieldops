import { quotes } from "@fieldops/core";
import { apiRoute, ifMatchVersion, jobEtag } from "@/server/api/handler";
import { toQuoteDto } from "@/server/api/serialize-billing";

type Params = { id: string };

/** A quote by id or number ("QUO-2026-0042"), with an ETag for If-Match. */
export const GET = apiRoute<Params>(async ({ req, params, ctx }) => {
  const quote = await quotes.getQuote(ctx, params.id);
  const etag = jobEtag(quote.version);
  if (req.headers.get("if-none-match") === etag) return { status: 304, headers: { ETag: etag } };
  return { body: toQuoteDto(quote), headers: { ETag: etag } };
});

/** Edits a draft quote. */
export const PATCH = apiRoute<Params>(async ({ req, params, body, ctx }) => {
  const quote = await quotes.updateQuote(ctx, params.id, body ?? {}, ifMatchVersion(req));
  return { body: toQuoteDto(quote), headers: { ETag: jobEtag(quote.version) } };
});
