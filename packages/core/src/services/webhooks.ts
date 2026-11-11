import {
  MAX_WEBHOOK_ENDPOINTS_PER_ORG,
  webhookDeliveryQuerySchema,
  webhookEndpointCreateSchema,
  webhookEndpointUpdateSchema,
  webhookSettingsUpdateSchema,
  type WebhookDeliveryDetailRepr,
  type WebhookDeliveryRepr,
  type WebhookEndpointRepr,
  type WebhookEndpointWithSecret,
  type WebhookSettingsRepr,
} from "@fieldops/shared";
import { ConflictError, NotFoundError, UnavailableError, ValidationError } from "../domain/errors";
import { assertCan, type Actor } from "../domain/permissions";
import type { TxRunner } from "./ai-types";
import { RelayError, type DeliveryPage, type EventRelay } from "./platform-types";
import { parseInput } from "./validate";

// Outgoing webhooks (PLT-03, §17.3, ADR 022). Owners and admins turn them on, add endpoints and read the delivery
// log. Relay holds endpoints, secrets and deliveries; FieldOps holds whether webhooks are on and the outbox its
// triggers fill. Relay is called outside any transaction: each step that needs the database runs in its own short
// transaction through `run`, so a slow Relay never holds a connection.

export interface WebhookDeps {
  actor: Actor;
  run: TxRunner;
  /** Null when RELAY_URL and RELAY_API_KEY aren't set. */
  relay: EventRelay | null;
  now?: Date;
}

/** Event types looked up in Relay per page when the outbox no longer has them (test events, older events). */
const MAX_TYPE_LOOKUPS = 10;

function requireRelay(relay: EventRelay | null): EventRelay {
  if (!relay) {
    throw new UnavailableError("Webhooks aren't configured on this server", {
      feature: "webhooks",
      reason: "not_configured",
    });
  }
  return relay;
}

/** Relay's answers as domain errors, so forms and the API report them like any other. */
async function call<T>(entity: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof RelayError)) throw err;
    if (err.status === 404) throw new NotFoundError(entity);
    if (err.status === 409) throw new ConflictError(err.message, { relayCode: err.code });
    if (err.status === 400 || err.status === 422) {
      const fields = err.fields.length ? err.fields : [{ path: "url", message: err.message }];
      throw new ValidationError(fields[0]!.message, fields);
    }
    throw new UnavailableError("Relay can't be reached right now. Try again in a minute.", {
      feature: "webhooks",
      reason: "relay_error",
    });
  }
}

export async function getSettings(d: WebhookDeps): Promise<WebhookSettingsRepr> {
  assertCan(d.actor, "webhooks.manage");
  const state = await d.run((ctx) => ctx.store.webhooks.state());
  return {
    configured: d.relay !== null,
    enabled: state.enabledAt !== null,
    enabled_at: state.enabledAt?.toISOString() ?? null,
  };
}

/**
 * Turns webhooks on (the organization becomes a Relay tenant first, then its changes start filling the outbox) or
 * off (no new events; endpoints stay as they are). Turning off works even without Relay.
 */
export async function setEnabled(d: WebhookDeps, raw: unknown): Promise<WebhookSettingsRepr> {
  assertCan(d.actor, "webhooks.manage");
  const { enabled } = parseInput(webhookSettingsUpdateSchema, raw);
  const state = await d.run((ctx) => ctx.store.webhooks.state());
  if (enabled && !state.enabledAt) {
    const relay = requireRelay(d.relay);
    await call("Organization", () => relay.ensureTenant(d.actor.organizationId, state.name));
    await d.run((ctx) => ctx.store.webhooks.setEnabled(d.now ?? ctx.now));
  } else if (!enabled && state.enabledAt) {
    await d.run((ctx) => ctx.store.webhooks.setEnabled(null));
  }
  return getSettings(d);
}

export async function listEndpoints(d: WebhookDeps): Promise<WebhookEndpointRepr[]> {
  assertCan(d.actor, "webhooks.manage");
  const relay = requireRelay(d.relay);
  return call("Webhook endpoint", () => relay.listEndpoints(d.actor.organizationId));
}

export async function getEndpoint(d: WebhookDeps, id: string): Promise<WebhookEndpointRepr> {
  assertCan(d.actor, "webhooks.manage");
  const relay = requireRelay(d.relay);
  const ep = await call("Webhook endpoint", () => relay.getEndpoint(d.actor.organizationId, id));
  if (!ep) throw new NotFoundError("Webhook endpoint");
  return ep;
}

function audit(
  d: WebhookDeps,
  op: "insert" | "update" | "delete",
  id: string,
  after: Record<string, unknown>,
) {
  return d.run((ctx) =>
    ctx.store.audit.record({
      action: `webhook_endpoint.${op}`,
      entityType: "webhook_endpoint",
      entityId: id,
      after,
    }),
  );
}

export async function createEndpoint(d: WebhookDeps, raw: unknown): Promise<WebhookEndpointWithSecret> {
  assertCan(d.actor, "webhooks.manage");
  const input = parseInput(webhookEndpointCreateSchema, raw);
  const relay = requireRelay(d.relay);
  const state = await d.run((ctx) => ctx.store.webhooks.state());
  if (!state.enabledAt) throw new ConflictError("Turn on webhooks first");
  const existing = await call("Webhook endpoint", () => relay.listEndpoints(d.actor.organizationId));
  if (existing.length >= MAX_WEBHOOK_ENDPOINTS_PER_ORG) {
    throw new ConflictError(`An organization can have at most ${MAX_WEBHOOK_ENDPOINTS_PER_ORG} endpoints`, {
      limit: MAX_WEBHOOK_ENDPOINTS_PER_ORG,
    });
  }
  // The tenant exists since webhooks were turned on; making sure costs one call and survives a Relay restored from
  // an older backup.
  await call("Organization", () => relay.ensureTenant(d.actor.organizationId, state.name));
  const created = await call("Webhook endpoint", () => relay.createEndpoint(d.actor.organizationId, input));
  await audit(d, "insert", created.endpoint.id, {
    url: created.endpoint.url,
    description: created.endpoint.description,
    event_types: created.endpoint.event_types,
  });
  return { ...created.endpoint, secret: created.secret };
}

export async function updateEndpoint(d: WebhookDeps, id: string, raw: unknown): Promise<WebhookEndpointRepr> {
  assertCan(d.actor, "webhooks.manage");
  const input = parseInput(webhookEndpointUpdateSchema, raw);
  const relay = requireRelay(d.relay);
  const updated = await call("Webhook endpoint", () =>
    relay.updateEndpoint(d.actor.organizationId, id, input),
  );
  if (!updated) throw new NotFoundError("Webhook endpoint");
  const changed = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(changed).length) await audit(d, "update", id, changed);
  return updated;
}

export async function deleteEndpoint(d: WebhookDeps, id: string): Promise<void> {
  assertCan(d.actor, "webhooks.manage");
  const relay = requireRelay(d.relay);
  const ep = await getEndpoint(d, id);
  const removed = await call("Webhook endpoint", () => relay.deleteEndpoint(d.actor.organizationId, id));
  if (!removed) throw new NotFoundError("Webhook endpoint");
  await audit(d, "delete", id, { url: ep.url });
}

/** A new signing secret, shown once. Relay keeps signing with the old one too for 24 hours. */
export async function rotateSecret(d: WebhookDeps, id: string): Promise<WebhookEndpointWithSecret> {
  assertCan(d.actor, "webhooks.manage");
  const relay = requireRelay(d.relay);
  const rotated = await call("Webhook endpoint", () => relay.rotateSecret(d.actor.organizationId, id));
  if (!rotated) throw new NotFoundError("Webhook endpoint");
  await audit(d, "update", id, { secret: "rotated" });
  return { ...rotated.endpoint, secret: rotated.secret };
}

/** Sends a `webhook.test` event to one endpoint, whatever it subscribes to. */
export async function sendTest(d: WebhookDeps, id: string): Promise<{ event_id: string }> {
  const ep = await getEndpoint(d, id);
  if (!ep.enabled) throw new ConflictError("Turn the endpoint on first");
  const relay = requireRelay(d.relay);
  const now = d.now ?? new Date();
  const eventId = await call("Webhook endpoint", () =>
    relay.sendTest(d.actor.organizationId, id, {
      message: "A test event from FieldOps. Your endpoint received it.",
      endpoint_id: id,
      sent_at: now.toISOString(),
      sent_by: d.actor.name,
    }),
  );
  return { event_id: eventId };
}

/** Fills in event types: from the outbox first (one query), then from Relay for the few it doesn't know. */
async function withEventTypes<T extends WebhookDeliveryRepr>(d: WebhookDeps, rows: T[]): Promise<T[]> {
  const relay = requireRelay(d.relay);
  const ids = [...new Set(rows.filter((r) => !r.event_type).map((r) => r.event_id))];
  if (!ids.length) return rows;
  const known = await d.run((ctx) => ctx.store.webhooks.eventTypes(ids));
  const missing = ids.filter((id) => !known[id]).slice(0, MAX_TYPE_LOOKUPS);
  const looked = await Promise.all(
    missing.map(async (id) => {
      const type = await relay.getEventType(d.actor.organizationId, id).catch(() => null);
      return [id, type] as const;
    }),
  );
  const types: Record<string, string | null> = { ...known, ...Object.fromEntries(looked) };
  return rows.map((r) => (r.event_type ? r : { ...r, event_type: types[r.event_id] ?? null }));
}

export async function listDeliveries(
  d: WebhookDeps,
  endpointId: string,
  rawQuery: unknown,
): Promise<DeliveryPage> {
  const query = parseInput(webhookDeliveryQuerySchema, rawQuery ?? {});
  await getEndpoint(d, endpointId);
  const relay = requireRelay(d.relay);
  const page = await call("Webhook endpoint", () =>
    relay.listDeliveries(d.actor.organizationId, {
      endpointId,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    }),
  );
  return { items: await withEventTypes(d, page.items), next_cursor: page.next_cursor };
}

export async function getDelivery(d: WebhookDeps, id: string): Promise<WebhookDeliveryDetailRepr> {
  assertCan(d.actor, "webhooks.manage");
  const relay = requireRelay(d.relay);
  const delivery = await call("Webhook delivery", () => relay.getDelivery(d.actor.organizationId, id));
  if (!delivery) throw new NotFoundError("Webhook delivery");
  const [filled] = await withEventTypes(d, [delivery]);
  return filled!;
}

/**
 * Delivers a dead delivery's event to its endpoint again, as a new delivery with a fresh set of attempts and the
 * same event id (receivers deduplicate on it). Pending and delivered ones can't be redelivered: Relay is still
 * retrying the first, and the second arrived.
 */
export async function redeliver(d: WebhookDeps, id: string): Promise<WebhookDeliveryRepr> {
  assertCan(d.actor, "webhooks.manage");
  const relay = requireRelay(d.relay);
  const current = await call("Webhook delivery", () => relay.getDelivery(d.actor.organizationId, id));
  if (!current) throw new NotFoundError("Webhook delivery");
  if (current.status !== "dead") {
    throw new ConflictError("Only deliveries that ran out of attempts can be redelivered", {
      relayCode: "not_dead",
    });
  }
  if (current.replayed_at)
    throw new ConflictError("This delivery was already redelivered", {
      relayCode: "already_replayed",
    });
  const fresh = await call("Webhook delivery", () => relay.redeliver(d.actor.organizationId, id));
  const [filled] = await withEventTypes(d, [
    { ...fresh, event_type: fresh.event_type ?? current.event_type },
  ]);
  return filled!;
}
