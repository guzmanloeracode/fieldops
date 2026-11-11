import { webhooks } from "@fieldops/core";
import { relayRoute } from "@/server/api/relay-route";

// Outgoing webhooks on or off for the organization (PLT-03). Owners and admins.

export const GET = relayRoute(async ({ deps }) => ({ body: await webhooks.getSettings(deps) }));

export const PUT = relayRoute(async ({ deps, body }) => ({ body: await webhooks.setEnabled(deps, body) }));
