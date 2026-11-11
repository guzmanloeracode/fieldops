import { webhooks } from "@fieldops/core";
import { relayRoute } from "@/server/api/relay-route";

// Webhook endpoints (PLT-03), kept in Relay. Owners and admins.

export const GET = relayRoute(async ({ deps }) => ({ body: { data: await webhooks.listEndpoints(deps) } }));

export const POST = relayRoute(async ({ deps, body }) => {
  const created = await webhooks.createEndpoint(deps, body);
  return { status: 201, body: created, headers: { Location: `/api/v1/webhook-endpoints/${created.id}` } };
});
