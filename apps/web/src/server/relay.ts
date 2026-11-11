import "server-only";
import type { webhooks } from "@fieldops/core";
import { createRelayClient } from "@fieldops/relay";
import { env } from "@/env";
import { runService, type ResolvedActor } from "./context";

// Outgoing webhooks (PLT-03, ADR 022): one Relay client per process, from RELAY_URL and RELAY_API_KEY. Without
// them there is no relay, and the webhooks settings say so.

export const relay =
  env.RELAY_URL && env.RELAY_API_KEY
    ? createRelayClient({ url: env.RELAY_URL, apiKey: env.RELAY_API_KEY })
    : null;

/** The public demo's test receiver (app/api/demo/webhook-sink): answers 204 and keeps nothing. */
export const DEMO_WEBHOOK_SINK_PATH = "/api/demo/webhook-sink";

/** Where demo endpoints may point besides webhook.site; null outside the demo. */
export const demoSinkUrl = env.DEMO_MODE ? new URL(DEMO_WEBHOOK_SINK_PATH, env.APP_URL).href : null;

/** The webhooks service's dependencies for a member: Relay calls between short tenant transactions. */
export function webhookDeps(actor: ResolvedActor): webhooks.WebhookDeps {
  return { actor, run: (fn) => runService(fn, actor), relay, demoSinkUrl };
}
