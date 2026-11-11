import { webhooks } from "@fieldops/core";
import { relayRoute } from "@/server/api/relay-route";

export const GET = relayRoute<{ id: string }>(async ({ deps, params }) => ({
  body: await webhooks.getEndpoint(deps, params.id),
}));

export const PATCH = relayRoute<{ id: string }>(async ({ deps, params, body }) => ({
  body: await webhooks.updateEndpoint(deps, params.id, body ?? {}),
}));

export const DELETE = relayRoute<{ id: string }>(async ({ deps, params }) => {
  await webhooks.deleteEndpoint(deps, params.id);
  return { status: 204 };
});
