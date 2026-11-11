import type { WebhookDeliveryDetailRepr, WebhookEndpointRepr } from "@fieldops/shared";
import { RelayError, type EventRelay } from "../services/platform-types";

/** An in-memory Relay for service tests: endpoints per tenant, deliveries the test puts in, and a call log. */
export function memoryRelay() {
  const tenants = new Map<string, string>();
  const endpoints = new Map<string, WebhookEndpointRepr & { org: string }>();
  const deliveries = new Map<string, WebhookDeliveryDetailRepr & { org: string }>();
  const eventTypes = new Map<string, string>();
  const calls: string[] = [];
  let n = 0;
  let failNext: RelayError | null = null;
  const guard = (name: string) => {
    calls.push(name);
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
  };
  const relay: EventRelay = {
    async ensureTenant(org, name) {
      guard("ensureTenant");
      tenants.set(org, name);
    },
    async publish(e) {
      guard("publish");
      return `evt_${e.id}`;
    },
    async getEventType(_org, id) {
      guard("getEventType");
      return eventTypes.get(id) ?? null;
    },
    async listEndpoints(org) {
      guard("listEndpoints");
      return [...endpoints.values()].filter((e) => e.org === org).map(({ org: _o, ...e }) => e);
    },
    async getEndpoint(org, id) {
      guard("getEndpoint");
      const e = endpoints.get(id);
      if (!e || e.org !== org) return null;
      const { org: _o, ...rest } = e;
      return rest;
    },
    async createEndpoint(org, input) {
      guard("createEndpoint");
      n += 1;
      const ep = {
        org,
        id: `ep_${n}`,
        url: input.url,
        description: input.description ?? null,
        event_types: input.event_types,
        enabled: true,
        disabled_reason: null,
        disabled_at: null,
        failure_streak: 0,
        failing_since: null,
        created_at: "2026-11-11T00:00:00.000Z",
      };
      endpoints.set(ep.id, ep);
      const { org: _o, ...endpoint } = ep;
      return { endpoint, secret: `whsec_${n}` };
    },
    async updateEndpoint(org, id, input) {
      guard("updateEndpoint");
      const e = endpoints.get(id);
      if (!e || e.org !== org) return null;
      if (input.url !== undefined) e.url = input.url;
      if (input.description !== undefined) e.description = input.description;
      if (input.event_types) e.event_types = input.event_types;
      if (input.enabled !== undefined) e.enabled = input.enabled;
      const { org: _o, ...rest } = e;
      return rest;
    },
    async deleteEndpoint(org, id) {
      guard("deleteEndpoint");
      const e = endpoints.get(id);
      if (!e || e.org !== org) return false;
      endpoints.delete(id);
      return true;
    },
    async rotateSecret(org, id) {
      guard("rotateSecret");
      const e = endpoints.get(id);
      if (!e || e.org !== org) return null;
      const { org: _o, ...endpoint } = e;
      return { endpoint, secret: "whsec_rotated" };
    },
    async sendTest(_org, id) {
      guard("sendTest");
      return `evt_test_${id}`;
    },
    async listDeliveries(org, f) {
      guard("listDeliveries");
      const items = [...deliveries.values()]
        .filter((d) => d.org === org && (!f.endpointId || d.endpoint_id === f.endpointId))
        .filter((d) => !f.status || d.status === f.status)
        .map(({ org: _o, attempt_log: _a, ...d }) => ({ ...d, event_type: null }));
      return { items, next_cursor: null };
    },
    async getDelivery(org, id) {
      guard("getDelivery");
      const d = deliveries.get(id);
      if (!d || d.org !== org) return null;
      const { org: _o, ...rest } = d;
      return { ...rest, event_type: null };
    },
    async redeliver(org, id) {
      guard("redeliver");
      const d = deliveries.get(id);
      if (!d || d.org !== org) throw new RelayError("Delivery not found", 404, "not_found");
      const { org: _o, attempt_log: _a, ...rest } = d;
      return { ...rest, id: `${id}_again`, status: "delivered", replay_of: id, event_type: null };
    },
    async retireTenant(org) {
      guard("retireTenant");
      tenants.delete(org);
    },
  };
  return {
    relay,
    tenants,
    endpoints,
    deliveries,
    eventTypes,
    calls,
    failWith(e: RelayError) {
      failNext = e;
    },
  };
}
