import { webhooks } from "@fieldops/core";
import { relayRoute } from "@/server/api/relay-route";

export const GET = relayRoute<{ id: string }>(async ({ deps, params }) => ({
  body: await webhooks.getDelivery(deps, params.id),
}));
