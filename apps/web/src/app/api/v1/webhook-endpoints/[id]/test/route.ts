import { webhooks } from "@fieldops/core";
import { relayRoute } from "@/server/api/relay-route";

export const POST = relayRoute<{ id: string }>(async ({ deps, params }) => ({
  status: 202,
  body: await webhooks.sendTest(deps, params.id),
}));
