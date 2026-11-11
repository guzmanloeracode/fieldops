import { webhooks } from "@fieldops/core";
import { queryObject } from "@/server/api/handler";
import { relayRoute } from "@/server/api/relay-route";

export const GET = relayRoute<{ id: string }>(async ({ deps, params, url }) => {
  const page = await webhooks.listDeliveries(deps, params.id, queryObject(url));
  return { body: { data: page.items, next_cursor: page.next_cursor } };
});
