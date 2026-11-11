import {
  RelayError,
  type CreatedEndpoint,
  type DeliveryFilters,
  type DeliveryPage,
  type EventRelay,
  type OutgoingEvent,
} from "@fieldops/core";
import {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TEST_EVENT,
  type WebhookAttemptRepr,
  type WebhookDeliveryDetailRepr,
  type WebhookDeliveryRepr,
  type WebhookEndpointRepr,
  type WebhookEventType,
} from "@fieldops/shared";

// The Relay HTTP client (PLT-03, ADR 022). One service key that isn't bound to a tenant (scopes ingest, read,
// manage and admin) works for every organization; the tenant is the organization ID. A FieldOps endpoint is one
// Relay webhook endpoint plus one subscription listing its event types; that subscription also names
// `webhook.test`, so a test event addressed to the endpoint (targets.endpoints) reaches it whatever it subscribes
// to, and no other endpoint, because every test event names its endpoint.

export interface RelayClientOptions {
  /** Relay's base URL, e.g. https://relay.example.com. */
  url: string;
  apiKey: string;
  fetch?: typeof fetch;
  /** Per request. Relay answers in milliseconds; a slow answer means it's in trouble. */
  timeoutMs?: number;
}

interface RelayEndpoint {
  id: string;
  channel: string;
  description: string;
  url: string | null;
  status: "active" | "disabled";
  disabled_reason: string | null;
  disabled_at: string | null;
  failure_streak: number;
  failing_since: string | null;
  created_at: string;
  secret?: string;
}

interface RelaySubscription {
  id: string;
  endpoint_id: string;
  event_types: string[];
}

interface RelayDelivery {
  id: string;
  event_id: string;
  endpoint_id: string;
  status: "pending" | "delivered" | "skipped" | "dead";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  dead_reason: string | null;
  replay_of: string | null;
  replayed_at: string | null;
  created_at: string;
  completed_at: string | null;
}

interface RelayAttempt {
  attempt: number;
  started_at: string;
  latency_ms: number;
  status_code: number | null;
  error: string | null;
  response_body: string | null;
  outcome: WebhookAttemptRepr["outcome"];
}

interface List<T> {
  data: T[];
  next_cursor: string | null;
}

const KNOWN_TYPES = new Set<string>(WEBHOOK_EVENT_TYPES);
const ENDPOINT_ID = /^ep_[0-9A-Za-z]+$/;
const DELIVERY_ID = /^dlv_[0-9A-Za-z]+$/;
const EVENT_ID = /^evt_[0-9A-Za-z]+$/;

/** The subscription's patterns for the endpoint's chosen types. */
export function relayEventTypes(types: (WebhookEventType | "*")[]): string[] {
  return types.includes("*") ? ["*"] : [...types, WEBHOOK_TEST_EVENT];
}

/** And back: what the person chose, without the test event. */
export function chosenEventTypes(patterns: string[]): (WebhookEventType | "*")[] {
  if (patterns.includes("*")) return ["*"];
  const chosen = WEBHOOK_EVENT_TYPES.filter((t) => patterns.includes(t));
  return [...chosen];
}

export function toEndpoint(ep: RelayEndpoint, patterns: string[]): WebhookEndpointRepr {
  return {
    id: ep.id,
    url: ep.url ?? "",
    description: ep.description || null,
    event_types: chosenEventTypes(patterns),
    enabled: ep.status === "active",
    disabled_reason: ep.status === "active" ? null : ep.disabled_reason,
    disabled_at: ep.status === "active" ? null : ep.disabled_at,
    failure_streak: ep.failure_streak,
    failing_since: ep.failing_since,
    created_at: ep.created_at,
  };
}

export function toDelivery(d: RelayDelivery): WebhookDeliveryRepr {
  const status: WebhookDeliveryRepr["status"] =
    d.status === "delivered"
      ? "delivered"
      : d.status === "pending"
        ? d.attempts > 0
          ? "retrying"
          : "pending"
        : "dead";
  return {
    id: d.id,
    endpoint_id: d.endpoint_id,
    event_id: d.event_id,
    event_type: null,
    status,
    attempts: d.attempts,
    max_attempts: d.max_attempts,
    next_attempt_at: d.next_attempt_at,
    last_status_code: d.last_status_code,
    last_error: d.last_error,
    dead_reason: d.dead_reason,
    replay_of: d.replay_of,
    replayed_at: d.replayed_at,
    created_at: d.created_at,
    completed_at: d.completed_at,
  };
}

function toAttempt(a: RelayAttempt): WebhookAttemptRepr {
  return {
    attempt: a.attempt,
    started_at: a.started_at,
    latency_ms: a.latency_ms,
    status_code: a.status_code,
    error: a.error,
    response_excerpt: a.response_body,
    outcome: a.outcome,
  };
}

export function createRelayClient(opts: RelayClientOptions): EventRelay {
  const base = opts.url.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const tenant = (org: string) => `/v1/tenants/${encodeURIComponent(org)}`;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new RelayError(
        timedOut ? "Relay didn't answer in time" : "Relay can't be reached",
        0,
        timedOut ? "timeout" : "unreachable",
      );
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const p = (json ?? {}) as {
        code?: string;
        title?: string;
        detail?: string;
        errors?: { path: string; message: string }[];
      };
      throw new RelayError(
        p.detail || p.title || `Relay answered ${res.status}`,
        res.status,
        p.code ?? "http_error",
        Array.isArray(p.errors) ? p.errors : [],
      );
    }
    return json as T;
  }

  /** null for a 404 (no such endpoint, delivery or tenant). */
  async function maybe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RelayError && err.status === 404) return null;
      throw err;
    }
  }

  async function subscriptions(org: string, endpointId?: string): Promise<RelaySubscription[]> {
    const q = new URLSearchParams({ limit: "100" });
    if (endpointId) q.set("endpoint_id", endpointId);
    const out: RelaySubscription[] = [];
    let cursor: string | null = null;
    do {
      if (cursor) q.set("cursor", cursor);
      const page: List<RelaySubscription> = await request("GET", `${tenant(org)}/subscriptions?${q}`);
      out.push(...page.data);
      cursor = page.next_cursor;
    } while (cursor);
    return out;
  }

  function patternsFor(subs: RelaySubscription[], endpointId: string): string[] {
    return subs.filter((s) => s.endpoint_id === endpointId).flatMap((s) => s.event_types);
  }

  async function endpoint(org: string, id: string): Promise<WebhookEndpointRepr | null> {
    if (!ENDPOINT_ID.test(id)) return null;
    const ep = await maybe(() => request<RelayEndpoint>("GET", `${tenant(org)}/endpoints/${id}`));
    if (!ep || ep.channel !== "webhook") return null;
    return toEndpoint(ep, patternsFor(await subscriptions(org, id), id));
  }

  return {
    async ensureTenant(org, name) {
      try {
        await request("POST", "/v1/tenants", { slug: org, name: name.trim().slice(0, 200) || org });
      } catch (err) {
        if (!(err instanceof RelayError) || err.status !== 409) throw err;
        // It exists already; make sure it wasn't left disabled.
        await request("PATCH", tenant(org), { disabled: false });
      }
    },

    async publish(e: OutgoingEvent) {
      const accepted = await request<{ id: string }>(
        "POST",
        "/v1/events",
        { tenant: e.organizationId, type: e.type, payload: e.payload },
        { "Idempotency-Key": e.id },
      );
      return accepted.id;
    },

    async getEventType(org, id) {
      if (!EVENT_ID.test(id)) return null;
      const ev = await maybe(() => request<{ type: string }>("GET", `${tenant(org)}/events/${id}`));
      return ev?.type ?? null;
    },

    async listEndpoints(org) {
      const page = await maybe(() =>
        request<List<RelayEndpoint>>("GET", `${tenant(org)}/endpoints?limit=100`),
      );
      if (!page) return [];
      const subs = await subscriptions(org);
      return page.data
        .filter((ep) => ep.channel === "webhook")
        .map((ep) => toEndpoint(ep, patternsFor(subs, ep.id)));
    },

    getEndpoint: endpoint,

    async createEndpoint(org, input): Promise<CreatedEndpoint> {
      const ep = await request<RelayEndpoint>("POST", `${tenant(org)}/endpoints`, {
        channel: "webhook",
        url: input.url,
        description: input.description ?? "",
        event_types: relayEventTypes(input.event_types),
      });
      return { endpoint: toEndpoint(ep, relayEventTypes(input.event_types)), secret: ep.secret ?? "" };
    },

    async updateEndpoint(org, id, input) {
      if (!ENDPOINT_ID.test(id)) return null;
      const path = `${tenant(org)}/endpoints/${id}`;
      const patch: Record<string, unknown> = {};
      if (input.url !== undefined) patch.url = input.url;
      if (input.description !== undefined) patch.description = input.description ?? "";
      const found = await maybe(() =>
        Object.keys(patch).length ? request("PATCH", path, patch) : request("GET", path),
      );
      if (!found) return null;
      if (input.event_types) {
        const types = relayEventTypes(input.event_types);
        const [first, ...rest] = await subscriptions(org, id);
        if (first) {
          await request("PATCH", `${tenant(org)}/subscriptions/${first.id}`, { event_types: types });
        } else {
          await request("POST", `${tenant(org)}/subscriptions`, { endpoint_id: id, event_types: types });
        }
        for (const s of rest) await request("DELETE", `${tenant(org)}/subscriptions/${s.id}`);
      }
      if (input.enabled !== undefined) {
        await request("POST", `${path}/${input.enabled ? "enable" : "disable"}`);
      }
      return endpoint(org, id);
    },

    async deleteEndpoint(org, id) {
      if (!ENDPOINT_ID.test(id)) return false;
      const done = await maybe(() => request("DELETE", `${tenant(org)}/endpoints/${id}`));
      return done !== null;
    },

    async rotateSecret(org, id) {
      if (!ENDPOINT_ID.test(id)) return null;
      const ep = await maybe(() =>
        request<RelayEndpoint>("POST", `${tenant(org)}/endpoints/${id}/rotate-secret`),
      );
      if (!ep) return null;
      return {
        endpoint: toEndpoint(ep, patternsFor(await subscriptions(org, id), id)),
        secret: ep.secret ?? "",
      };
    },

    async sendTest(org, id, payload) {
      const accepted = await request<{ id: string }>(
        "POST",
        "/v1/events",
        { tenant: org, type: WEBHOOK_TEST_EVENT, payload, targets: { endpoints: [id] } },
        { "Idempotency-Key": `test-${crypto.randomUUID()}` },
      );
      return accepted.id;
    },

    async listDeliveries(org, f: DeliveryFilters): Promise<DeliveryPage> {
      const q = new URLSearchParams({ limit: String(f.limit ?? 25) });
      if (f.endpointId) {
        if (!ENDPOINT_ID.test(f.endpointId)) return { items: [], next_cursor: null };
        q.set("endpoint_id", f.endpointId);
      }
      if (f.status) q.set("status", f.status === "retrying" ? "pending" : f.status);
      if (f.cursor) q.set("cursor", f.cursor);
      const page = await maybe(() => request<List<RelayDelivery>>("GET", `${tenant(org)}/deliveries?${q}`));
      if (!page) return { items: [], next_cursor: null };
      const items = page.data.map(toDelivery).filter((d) => !f.status || d.status === f.status);
      return { items, next_cursor: page.next_cursor };
    },

    async getDelivery(org, id): Promise<WebhookDeliveryDetailRepr | null> {
      if (!DELIVERY_ID.test(id)) return null;
      const d = await maybe(() =>
        request<RelayDelivery & { attempt_log: RelayAttempt[] }>("GET", `${tenant(org)}/deliveries/${id}`),
      );
      if (!d) return null;
      return { ...toDelivery(d), attempt_log: (d.attempt_log ?? []).map(toAttempt) };
    },

    async redeliver(org, id) {
      if (!DELIVERY_ID.test(id)) throw new RelayError("Delivery not found", 404, "not_found");
      return toDelivery(await request<RelayDelivery>("POST", `${tenant(org)}/deliveries/${id}/replay`));
    },

    async retireTenant(org) {
      const page = await maybe(() =>
        request<List<RelayEndpoint>>("GET", `${tenant(org)}/endpoints?limit=100`),
      );
      if (!page) return;
      for (const ep of page.data) await maybe(() => request("DELETE", `${tenant(org)}/endpoints/${ep.id}`));
      await maybe(() => request("PATCH", tenant(org), { disabled: true }));
    },
  };
}

export const isKnownEventType = (t: string) => KNOWN_TYPES.has(t);
