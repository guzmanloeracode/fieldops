import { webhooks } from "@fieldops/core";
import { relayRoute } from "@/server/api/relay-route";

export const POST = relayRoute<{ id: string }>(async ({ deps, params }) => ({
  body: await webhooks.rotateSecret(deps, params.id),
}));
