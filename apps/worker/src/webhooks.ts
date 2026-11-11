import type { EventRelay } from "@fieldops/core";
import { organizationsWithWebhooks, publishOutbox, type Database } from "@fieldops/db";
import { createRelayClient } from "@fieldops/relay";
import { env } from "./env";
import { log } from "./log";

// Outgoing webhooks (PLT-03, §11.4, ADR 022): the worker posts outbox events to Relay (publishOutbox in
// packages/db claims them with FOR UPDATE SKIP LOCKED and a lease, and posts each outside any transaction).

/** Null without RELAY_URL and RELAY_API_KEY: then no organization can turn webhooks on. */
export const relay: EventRelay | null =
  env.relay.url && env.relay.apiKey
    ? createRelayClient({ url: env.relay.url, apiKey: env.relay.apiKey })
    : null;

export const BATCH = 50;

/** One pass of the outbox. Returns how many events were sent. */
export function publishPending(db: Database, client: EventRelay): Promise<number> {
  return publishOutbox(db, client, {
    limit: BATCH,
    onFailure: (f) =>
      log[f.outcome === "failed" ? "error" : "warn"](
        { id: f.id, type: f.type, attempt: f.attempt, err: f.error },
        f.outcome === "failed" ? "webhook event given up" : "webhook event not sent; will retry",
      ),
  });
}

/**
 * Before the nightly demo reset: organizations get new IDs, so their Relay tenants would be left behind. Delete
 * their endpoints and disable them. Best effort: a Relay outage must not stop the reset.
 */
export async function retireDemoTenants(db: Database, client: EventRelay | null): Promise<number> {
  if (!client) return 0;
  const orgs = await organizationsWithWebhooks(db);
  let retired = 0;
  for (const org of orgs) {
    try {
      await client.retireTenant(org);
      retired += 1;
    } catch (err) {
      log.warn({ err, org }, "couldn't retire a Relay tenant before the demo reset");
    }
  }
  return retired;
}
