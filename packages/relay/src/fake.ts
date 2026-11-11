import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A fake Relay (PLT-03): just the part of Relay's API the FieldOps client uses, in memory, for unit tests, local
// development and the image E2E. It doesn't call endpoints. Every event is "delivered" at once, except to an
// endpoint whose URL path contains `/fail` (one attempt answered 500, then dead, as if its attempts ran out) or
// `/retry` (one attempt answered 503, waiting to retry). Host names like localhost or *.internal are refused like
// Relay's SSRF guard refuses private addresses.

export interface FakeRelayOptions {
  port?: number;
  host?: string;
  apiKey: string;
}

export interface FakeRelay {
  url: string;
  close(): Promise<void>;
  /** For tests: the events Relay accepted, newest last. */
  events(): FakeEvent[];
}

interface FakeEvent {
  id: string;
  tenant: string;
  type: string;
  payload: unknown;
  targets: { endpoints?: string[] } | null;
  created_at: string;
}

interface FakeEndpoint {
  id: string;
  channel: "webhook";
  description: string;
  url: string;
  email_to: string[];
  max_in_flight: number;
  status: "active" | "disabled";
  disabled_reason: string | null;
  disabled_at: string | null;
  failure_streak: number;
  failing_since: string | null;
  created_at: string;
  updated_at: string;
  secret: string;
}

interface FakeAttempt {
  attempt: number;
  started_at: string;
  latency_ms: number;
  status_code: number | null;
  error: string | null;
  response_body: string | null;
  outcome: "delivered" | "retry" | "dead";
}

interface FakeDelivery {
  id: string;
  event_id: string;
  endpoint_id: string;
  channel: "webhook";
  recipient: null;
  status: "pending" | "delivered" | "dead";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  last_latency_ms: number | null;
  dead_reason: string | null;
  replay_of: string | null;
  replayed_at: string | null;
  created_at: string;
  completed_at: string | null;
  attempt_log: FakeAttempt[];
}

interface FakeTenant {
  id: string;
  slug: string;
  name: string;
  disabled: boolean;
  endpoints: Map<string, FakeEndpoint>;
  subscriptions: Map<string, { id: string; endpoint_id: string; event_types: string[]; created_at: string }>;
  deliveries: Map<string, FakeDelivery>;
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const TYPE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

let seq = 0;
/** Sortable ids, like Relay's (prefix + time-ordered suffix). */
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(4, "0")}${randomBytes(4).toString("hex")}`;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

function matches(pattern: string, type: string): boolean {
  if (pattern === "*" || pattern === type) return true;
  return pattern.endsWith(".*") && type.startsWith(`${pattern.slice(0, -2)}.`);
}

function publicUrl(raw: unknown): string {
  if (typeof raw !== "string")
    throw new HttpError(422, "validation_failed", "url is required", [
      { path: "url", message: "is required" },
    ]);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(422, "validation_failed", "url is not a URL", [
      { path: "url", message: "must be a URL" },
    ]);
  }
  const host = u.hostname;
  if (
    host === "localhost" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^[\d.]+$/.test(host)
  ) {
    throw new HttpError(422, "validation_failed", "url must point to a public address", [
      { path: "url", message: "must point to a public address" },
    ]);
  }
  return raw;
}

function eventTypes(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.some((t) => typeof t !== "string")) {
    throw new HttpError(422, "validation_failed", "event_types must be a list of strings", [
      { path: "event_types", message: "must be a list of strings" },
    ]);
  }
  return raw as string[];
}

export async function startFakeRelay(opts: FakeRelayOptions): Promise<FakeRelay> {
  const tenants = new Map<string, FakeTenant>();
  const events: FakeEvent[] = [];
  const idempotency = new Map<string, { body: string; response: unknown }>();
  const now = () => new Date().toISOString();

  function tenantOf(slug: string): FakeTenant {
    const t = tenants.get(slug);
    if (!t) throw new HttpError(404, "not_found", "Tenant not found");
    return t;
  }

  function attemptFor(ep: FakeEndpoint, n: number): FakeAttempt {
    const path = new URL(ep.url).pathname;
    if (path.includes("/fail")) {
      return {
        attempt: n,
        started_at: now(),
        latency_ms: 42,
        status_code: 500,
        error: "HTTP 500",
        response_body: '{"error":"internal"}',
        outcome: "dead",
      };
    }
    if (path.includes("/retry")) {
      return {
        attempt: n,
        started_at: now(),
        latency_ms: 35,
        status_code: 503,
        error: "HTTP 503",
        response_body: "Service Unavailable",
        outcome: "retry",
      };
    }
    return {
      attempt: n,
      started_at: now(),
      latency_ms: 27,
      status_code: 200,
      error: null,
      response_body: "ok",
      outcome: "delivered",
    };
  }

  function deliver(t: FakeTenant, eventId: string, ep: FakeEndpoint, replayOf: string | null): FakeDelivery {
    const a = attemptFor(ep, 1);
    const d: FakeDelivery = {
      id: newId("dlv"),
      event_id: eventId,
      endpoint_id: ep.id,
      channel: "webhook",
      recipient: null,
      status: a.outcome === "delivered" ? "delivered" : a.outcome === "dead" ? "dead" : "pending",
      attempts: 1,
      max_attempts: 8,
      next_attempt_at: a.outcome === "retry" ? new Date(Date.now() + 75_000).toISOString() : null,
      last_status_code: a.status_code,
      last_error: a.error,
      last_latency_ms: a.latency_ms,
      dead_reason: a.outcome === "dead" ? "max_attempts" : null,
      replay_of: replayOf,
      replayed_at: null,
      created_at: now(),
      completed_at: a.outcome === "retry" ? null : now(),
      attempt_log: [a],
    };
    t.deliveries.set(d.id, d);
    if (a.outcome === "delivered") {
      ep.failure_streak = 0;
      ep.failing_since = null;
    } else {
      ep.failure_streak += 1;
      ep.failing_since ??= now();
    }
    return d;
  }

  const view = (ep: FakeEndpoint, withSecret = false) => {
    const { secret, ...rest } = ep;
    return withSecret ? { ...rest, secret } : rest;
  };
  const deliveryView = (d: FakeDelivery) => {
    const { attempt_log: _log, ...rest } = d;
    return rest;
  };

  function page<T extends { id: string }>(rows: T[], q: URLSearchParams) {
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1));
    const limit = Math.min(100, Math.max(1, Number(q.get("limit") ?? 50)));
    const start = Number(q.get("cursor") ?? 0);
    const data = sorted.slice(start, start + limit);
    return { data, next_cursor: start + limit < sorted.length ? String(start + limit) : null };
  }

  async function handle(
    method: string,
    path: string,
    q: URLSearchParams,
    body: Record<string, unknown>,
    raw: string,
    req: IncomingMessage,
  ): Promise<[number, unknown]> {
    if (method === "GET" && path === "/healthz") return [200, { status: "ok" }];
    if (req.headers.authorization !== `Bearer ${opts.apiKey}`) {
      throw new HttpError(401, "unauthenticated", "No valid API key");
    }
    const seg = path.split("/").filter(Boolean); // v1, …

    if (path === "/v1/tenants" && method === "POST") {
      const slug = String(body.slug ?? "");
      if (!SLUG.test(slug))
        throw new HttpError(422, "validation_failed", "slug is invalid", [
          { path: "slug", message: "is invalid" },
        ]);
      if (tenants.has(slug)) throw new HttpError(409, "slug_taken", "Another tenant already has this slug");
      const t: FakeTenant = {
        id: newId("ten"),
        slug,
        name: String(body.name ?? slug),
        disabled: false,
        endpoints: new Map(),
        subscriptions: new Map(),
        deliveries: new Map(),
      };
      tenants.set(slug, t);
      return [201, { id: t.id, slug, name: t.name, disabled: false }];
    }

    if (path === "/v1/events" && method === "POST") {
      const key = req.headers["idempotency-key"];
      if (typeof key === "string") {
        const seen = idempotency.get(key);
        if (seen) {
          if (seen.body !== raw) {
            throw new HttpError(422, "idempotency_key_reused", "Idempotency-Key reused with another body");
          }
          return [202, seen.response];
        }
      }
      const t = tenantOf(String(body.tenant ?? ""));
      if (t.disabled) throw new HttpError(403, "tenant_disabled", "The tenant is disabled");
      const type = String(body.type ?? "");
      if (!TYPE.test(type))
        throw new HttpError(422, "validation_failed", "type is invalid", [
          { path: "type", message: "is invalid" },
        ]);
      if (!body.payload || typeof body.payload !== "object") {
        throw new HttpError(422, "validation_failed", "payload must be an object", [
          { path: "payload", message: "must be an object" },
        ]);
      }
      const targets = (body.targets as { endpoints?: string[] } | undefined) ?? null;
      const ev: FakeEvent = {
        id: newId("evt"),
        tenant: t.slug,
        type,
        payload: body.payload,
        targets,
        created_at: now(),
      };
      events.push(ev);
      for (const ep of t.endpoints.values()) {
        if (ep.status !== "active") continue;
        if (targets?.endpoints?.length && !targets.endpoints.includes(ep.id)) continue;
        const subscribed = [...t.subscriptions.values()].some(
          (s) => s.endpoint_id === ep.id && s.event_types.some((p) => matches(p, type)),
        );
        if (subscribed) deliver(t, ev.id, ep, null);
      }
      const response = { id: ev.id, tenant: t.slug, type, status: "accepted", created_at: ev.created_at };
      if (typeof key === "string") idempotency.set(key, { body: raw, response });
      return [202, response];
    }

    if (seg[0] !== "v1" || seg[1] !== "tenants" || !seg[2]) throw new HttpError(404, "not_found", "No route");
    const t = tenantOf(decodeURIComponent(seg[2]));
    const [, , , coll, id, action] = seg;

    if (!coll) {
      if (method === "PATCH") {
        if (typeof body.disabled === "boolean") t.disabled = body.disabled;
        if (typeof body.name === "string") t.name = body.name;
      }
      return [200, { id: t.id, slug: t.slug, name: t.name, disabled: t.disabled }];
    }

    if (coll === "events" && id && method === "GET") {
      const ev = events.find((e) => e.id === id && e.tenant === t.slug);
      if (!ev) throw new HttpError(404, "not_found", "Event not found");
      return [
        200,
        { ...ev, deliveries: [...t.deliveries.values()].filter((d) => d.event_id === id).map(deliveryView) },
      ];
    }

    if (coll === "endpoints") {
      if (!id) {
        if (method === "GET")
          return [200, page([...t.endpoints.values()].map((e) => view(e)) as FakeEndpoint[], q)];
        if (method === "POST") {
          const ep: FakeEndpoint = {
            id: newId("ep"),
            channel: "webhook",
            description: typeof body.description === "string" ? body.description : "",
            url: publicUrl(body.url),
            email_to: [],
            max_in_flight: 4,
            status: "active",
            disabled_reason: null,
            disabled_at: null,
            failure_streak: 0,
            failing_since: null,
            created_at: now(),
            updated_at: now(),
            secret: `whsec_${randomBytes(24).toString("base64")}`,
          };
          if (body.event_types !== undefined) {
            const types = eventTypes(body.event_types);
            const sub = { id: newId("sub"), endpoint_id: ep.id, event_types: types, created_at: now() };
            t.subscriptions.set(sub.id, sub);
          }
          t.endpoints.set(ep.id, ep);
          return [201, view(ep, true)];
        }
      }
      const ep = id ? t.endpoints.get(id) : undefined;
      if (!ep) throw new HttpError(404, "not_found", "Endpoint not found");
      if (!action) {
        if (method === "GET") return [200, view(ep)];
        if (method === "PATCH") {
          if (body.url !== undefined) ep.url = publicUrl(body.url);
          if (typeof body.description === "string") ep.description = body.description;
          ep.updated_at = now();
          return [200, view(ep)];
        }
        if (method === "DELETE") {
          t.endpoints.delete(ep.id);
          for (const [sid, s] of t.subscriptions) if (s.endpoint_id === ep.id) t.subscriptions.delete(sid);
          for (const [did, d] of t.deliveries) if (d.endpoint_id === ep.id) t.deliveries.delete(did);
          return [204, undefined];
        }
      }
      if (method === "POST" && action === "rotate-secret") {
        ep.secret = `whsec_${randomBytes(24).toString("base64")}`;
        return [200, view(ep, true)];
      }
      if (method === "POST" && action === "enable") {
        Object.assign(ep, { status: "active", disabled_reason: null, disabled_at: null, failure_streak: 0 });
        return [200, view(ep)];
      }
      if (method === "POST" && action === "disable") {
        if (ep.status === "active") {
          Object.assign(ep, {
            status: "disabled",
            disabled_reason: "disabled through the API",
            disabled_at: now(),
          });
          for (const d of t.deliveries.values()) {
            if (d.endpoint_id === ep.id && d.status === "pending") {
              Object.assign(d, { status: "dead", dead_reason: "endpoint_disabled", completed_at: now() });
            }
          }
        }
        return [200, view(ep)];
      }
    }

    if (coll === "subscriptions") {
      if (!id) {
        if (method === "GET") {
          const ep = q.get("endpoint_id");
          return [
            200,
            page(
              [...t.subscriptions.values()].filter((s) => !ep || s.endpoint_id === ep),
              q,
            ),
          ];
        }
        if (method === "POST") {
          const endpointId = String(body.endpoint_id ?? "");
          if (!t.endpoints.has(endpointId)) throw new HttpError(404, "not_found", "Endpoint not found");
          const sub = {
            id: newId("sub"),
            endpoint_id: endpointId,
            event_types: eventTypes(body.event_types),
            created_at: now(),
          };
          t.subscriptions.set(sub.id, sub);
          return [201, sub];
        }
      }
      const sub = id ? t.subscriptions.get(id) : undefined;
      if (!sub) throw new HttpError(404, "not_found", "Subscription not found");
      if (method === "PATCH") {
        sub.event_types = eventTypes(body.event_types);
        return [200, sub];
      }
      if (method === "DELETE") {
        t.subscriptions.delete(sub.id);
        return [204, undefined];
      }
    }

    if (coll === "deliveries") {
      if (!id && method === "GET") {
        const rows = [...t.deliveries.values()].filter(
          (d) =>
            (!q.get("endpoint_id") || d.endpoint_id === q.get("endpoint_id")) &&
            (!q.get("event_id") || d.event_id === q.get("event_id")) &&
            (!q.get("status") || d.status === q.get("status")),
        );
        const p = page(rows, q);
        return [200, { ...p, data: p.data.map(deliveryView) }];
      }
      const d = id ? t.deliveries.get(id) : undefined;
      if (!d) throw new HttpError(404, "not_found", "Delivery not found");
      if (!action && method === "GET") return [200, d];
      if (action === "replay" && method === "POST") {
        if (d.status !== "dead")
          throw new HttpError(409, "not_dead", "Only deliveries in the dead-letter queue can be replayed.");
        if (d.replayed_at)
          throw new HttpError(409, "already_replayed", "This delivery was already replayed.");
        const ep = t.endpoints.get(d.endpoint_id);
        if (!ep || ep.status !== "active") {
          throw new HttpError(
            409,
            "endpoint_disabled",
            "The endpoint is disabled. Enable it first, then replay.",
          );
        }
        d.replayed_at = now();
        return [202, deliveryView(deliver(t, d.event_id, ep, d.id))];
      }
    }
    throw new HttpError(405, "method_not_allowed", "Not supported by the fake Relay");
  }

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "/", "http://fake-relay");
      let body: Record<string, unknown>;
      const send = (status: number, payload: unknown, type = "application/json") => {
        res.writeHead(status, payload === undefined ? {} : { "Content-Type": type });
        res.end(payload === undefined ? undefined : JSON.stringify(payload));
      };
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        send(
          400,
          { type: "about:blank", title: "Bad request", status: 400, code: "invalid_json" },
          "application/problem+json",
        );
        return;
      }
      handle(req.method ?? "GET", url.pathname, url.searchParams, body, raw, req)
        .then(([status, payload]) => send(status, payload))
        .catch((err: unknown) => {
          const e = err instanceof HttpError ? err : new HttpError(500, "internal", "Fake Relay failed");
          send(
            e.status,
            {
              type: "about:blank",
              title: e.message,
              status: e.status,
              code: e.code,
              detail: e.message,
              errors: e.errors,
            },
            "application/problem+json",
          );
        });
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://${opts.host === "0.0.0.0" ? "127.0.0.1" : (opts.host ?? "127.0.0.1")}:${addr.port}`,
    events: () => [...events],
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
