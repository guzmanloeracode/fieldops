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

/** The webhooks service's dependencies for a member: Relay calls between short tenant transactions. */
export function webhookDeps(actor: ResolvedActor): webhooks.WebhookDeps {
  return { actor, run: (fn) => runService(fn, actor), relay };
}
