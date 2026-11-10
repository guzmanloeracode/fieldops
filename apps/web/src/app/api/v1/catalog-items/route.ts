import { catalog } from "@fieldops/core";
import { apiRoute, queryObject } from "@/server/api/handler";
import { toCatalogItemDto } from "@/server/api/serialize-billing";

/** Parts and fees for quote and invoice lines (FIN-01); `q` searches the name and SKU. */
export const GET = apiRoute(async ({ url, ctx }) => {
  const items = await catalog.listCatalog(ctx, queryObject(url));
  return { body: { data: items.map(toCatalogItemDto), next_cursor: null } };
});
