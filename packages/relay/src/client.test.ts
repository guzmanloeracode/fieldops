import { RelayError, type EventRelay } from "@fieldops/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chosenEventTypes, createRelayClient, relayEventTypes, toDelivery } from "./client";
import { startFakeRelay, type FakeRelay } from "./fake";

const ORG = "01a1c8e0-4d23-7473-b18e-00646fb12f15";
const OTHER = "01a1c8e0-4d23-7473-b18e-00646fb12f16";
let fake: FakeRelay;
let relay: EventRelay;

beforeAll(async () => {
  fake = await startFakeRelay({ apiKey: "rk_test" });
  relay = createRelayClient({ url: `${fake.url}/`, apiKey: "rk_test" });
  await relay.ensureTenant(ORG, "Acme Air");
});
afterAll(async () => fake.close());

describe("event types", () => {
  it("adds the test event to chosen types and strips it again", () => {
    expect(relayEventTypes(["job.created"])).toEqual(["job.created", "webhook.test"]);
    expect(relayEventTypes(["*"])).toEqual(["*"]);
    expect(chosenEventTypes(["job.created", "webhook.test", "relay.other"])).toEqual(["job.created"]);
    expect(chosenEventTypes(["webhook.test", "*"])).toEqual(["*"]);
  });
});

describe("tenants and events", () => {
  it("creates a tenant once and re-enables an existing one", async () => {
    await relay.ensureTenant(ORG, "Acme Air");
    await relay.retireTenant(OTHER); // no tenant: nothing to do
    await relay.ensureTenant(OTHER, "  ");
    await relay.retireTenant(OTHER);
    await expect(
      relay.publish({ id: "o-1", organizationId: OTHER, type: "job.created", payload: {} }),
    ).rejects.toMatchObject({ status: 403, code: "tenant_disabled" });
    await relay.ensureTenant(OTHER, "Other");
    await expect(
      relay.publish({ id: "o-2", organizationId: OTHER, type: "job.created", payload: {} }),
    ).resolves.toMatch(/^evt_/);
  });

  it("publishes idempotently on the outbox id", async () => {
    const e = { id: "row-1", organizationId: ORG, type: "job.created", payload: { job: { id: "j1" } } };
    const first = await relay.publish(e);
    expect(await relay.publish(e)).toBe(first);
    expect(await relay.getEventType(ORG, first)).toBe("job.created");
    expect(await relay.getEventType(ORG, "evt_missing")).toBeNull();
    expect(await relay.getEventType(ORG, "nope")).toBeNull();
  });

  it("reports Relay's problems and unreachable hosts as RelayError", async () => {
    const bad = createRelayClient({ url: fake.url, apiKey: "wrong" });
    await expect(bad.listEndpoints(ORG)).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    const down = createRelayClient({ url: "http://127.0.0.1:9", apiKey: "x", timeoutMs: 500 });
    const err = await down.listEndpoints(ORG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).status).toBe(0);
    const slow = createRelayClient({
      url: fake.url,
      apiKey: "rk_test",
      timeoutMs: 1,
      fetch: (_u, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))),
        ),
    });
    await expect(slow.listEndpoints(ORG)).rejects.toMatchObject({ code: "timeout" });
    const html = createRelayClient({
      url: fake.url,
      apiKey: "rk_test",
      fetch: async () => new Response("<html>", { status: 502 }),
    });
    await expect(html.listEndpoints(ORG)).rejects.toMatchObject({ status: 502, code: "http_error" });
  });
});

describe("endpoints", () => {
  it("creates, reads, updates and deletes an endpoint with its event types", async () => {
    const { endpoint, secret } = await relay.createEndpoint(ORG, {
      url: "https://hooks.example.com/fieldops",
      description: "CRM sync",
      event_types: ["job.created", "job.completed"],
    });
    expect(secret).toMatch(/^whsec_/);
    expect(endpoint).toMatchObject({
      url: "https://hooks.example.com/fieldops",
      description: "CRM sync",
      event_types: ["job.created", "job.completed"],
      enabled: true,
      disabled_reason: null,
    });
    expect(await relay.getEndpoint(ORG, endpoint.id)).toMatchObject({
      event_types: ["job.created", "job.completed"],
    });
    expect(await relay.getEndpoint(ORG, "ep_missing")).toBeNull();
    expect(await relay.getEndpoint(ORG, "not-an-id")).toBeNull();

    const updated = await relay.updateEndpoint(ORG, endpoint.id, {
      url: "https://hooks.example.com/v2",
      description: null,
      event_types: ["*"],
      enabled: false,
    });
    expect(updated).toMatchObject({
      url: "https://hooks.example.com/v2",
      description: null,
      event_types: ["*"],
      enabled: false,
      disabled_reason: "disabled through the API",
    });
    expect(await relay.updateEndpoint(ORG, endpoint.id, { enabled: true })).toMatchObject({ enabled: true });
    expect(await relay.updateEndpoint(ORG, "ep_missing", { enabled: true })).toBeNull();
    expect(await relay.updateEndpoint(ORG, "bad", { enabled: true })).toBeNull();

    const rotated = await relay.rotateSecret(ORG, endpoint.id);
    expect(rotated?.secret).toMatch(/^whsec_/);
    expect(rotated?.secret).not.toBe(secret);
    expect(await relay.rotateSecret(ORG, "ep_missing")).toBeNull();
    expect(await relay.rotateSecret(ORG, "bad")).toBeNull();

    expect((await relay.listEndpoints(ORG)).map((e) => e.id)).toContain(endpoint.id);
    expect(await relay.deleteEndpoint(ORG, endpoint.id)).toBe(true);
    expect(await relay.deleteEndpoint(ORG, endpoint.id)).toBe(false);
    expect(await relay.deleteEndpoint(ORG, "bad")).toBe(false);
  });

  it("recreates a missing subscription and drops extra ones", async () => {
    const { endpoint } = await relay.createEndpoint(ORG, {
      url: "https://hooks.example.com/subs",
      description: null,
      event_types: ["job.created"],
    });
    // Two subscriptions, as another client could have made them.
    const auth = { Authorization: "Bearer rk_test", "Content-Type": "application/json" };
    await fetch(`${fake.url}/v1/tenants/${ORG}/subscriptions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ endpoint_id: endpoint.id, event_types: ["quote.sent"] }),
    });
    const both = await relay.getEndpoint(ORG, endpoint.id);
    expect(both?.event_types).toEqual(["job.created", "quote.sent"]);
    await relay.updateEndpoint(ORG, endpoint.id, { event_types: ["invoice.paid"] });
    expect((await relay.getEndpoint(ORG, endpoint.id))?.event_types).toEqual(["invoice.paid"]);
    // No subscription at all: updating types creates one.
    const subs = (await (
      await fetch(`${fake.url}/v1/tenants/${ORG}/subscriptions?endpoint_id=${endpoint.id}`, { headers: auth })
    ).json()) as { data: { id: string }[] };
    for (const s of subs.data) {
      await fetch(`${fake.url}/v1/tenants/${ORG}/subscriptions/${s.id}`, { method: "DELETE", headers: auth });
    }
    await relay.updateEndpoint(ORG, endpoint.id, { event_types: ["sla.breached"] });
    expect((await relay.getEndpoint(ORG, endpoint.id))?.event_types).toEqual(["sla.breached"]);
  });

  it("passes Relay's field errors through", async () => {
    const err = await relay
      .createEndpoint(ORG, { url: "https://localhost/hook", description: null, event_types: ["*"] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).status).toBe(422);
    expect((err as RelayError).fields[0]?.path).toBe("url");
  });

  it("lists nothing for an organization that never turned webhooks on", async () => {
    const stranger = "01a1c8e0-0000-7000-8000-000000000000";
    expect(await relay.listEndpoints(stranger)).toEqual([]);
    expect(await relay.listDeliveries(stranger, {})).toEqual({ items: [], next_cursor: null });
  });
});

describe("deliveries", () => {
  it("sends a test event to one endpoint only, whatever it subscribes to", async () => {
    const a = await relay.createEndpoint(ORG, {
      url: "https://a.example.com/hook",
      description: null,
      event_types: ["invoice.paid"],
    });
    const b = await relay.createEndpoint(ORG, {
      url: "https://b.example.com/hook",
      description: null,
      event_types: ["*"],
    });
    const eventId = await relay.sendTest(ORG, a.endpoint.id, { message: "hi" });
    const forA = await relay.listDeliveries(ORG, { endpointId: a.endpoint.id });
    const forB = await relay.listDeliveries(ORG, { endpointId: b.endpoint.id });
    expect(forA.items.map((d) => d.event_id)).toEqual([eventId]);
    expect(forA.items[0]).toMatchObject({ status: "delivered", attempts: 1, event_type: null });
    expect(forB.items.map((d) => d.event_id)).not.toContain(eventId);
    expect(await relay.listDeliveries(ORG, { endpointId: "bad" })).toEqual({ items: [], next_cursor: null });
  });

  it("shows failed attempts and redelivers dead deliveries after the endpoint is fixed", async () => {
    const { endpoint } = await relay.createEndpoint(ORG, {
      url: "https://c.example.com/fail",
      description: null,
      event_types: ["job.completed"],
    });
    await relay.publish({ id: "row-fail", organizationId: ORG, type: "job.completed", payload: {} });
    const page = await relay.listDeliveries(ORG, { endpointId: endpoint.id, status: "dead", limit: 10 });
    expect(page.items).toHaveLength(1);
    const dead = page.items[0]!;
    expect(dead).toMatchObject({ status: "dead", last_status_code: 500, dead_reason: "max_attempts" });
    const detail = await relay.getDelivery(ORG, dead.id);
    expect(detail?.attempt_log[0]).toMatchObject({
      status_code: 500,
      outcome: "dead",
      response_excerpt: '{"error":"internal"}',
    });
    expect(await relay.getDelivery(ORG, "dlv_missing")).toBeNull();
    expect(await relay.getDelivery(ORG, "bad")).toBeNull();

    await relay.updateEndpoint(ORG, endpoint.id, { url: "https://c.example.com/ok" });
    const again = await relay.redeliver(ORG, dead.id);
    expect(again).toMatchObject({ status: "delivered", replay_of: dead.id, event_id: dead.event_id });
    await expect(relay.redeliver(ORG, dead.id)).rejects.toMatchObject({
      status: 409,
      code: "already_replayed",
    });
    await expect(relay.redeliver(ORG, again.id)).rejects.toMatchObject({ status: 409, code: "not_dead" });
    await expect(relay.redeliver(ORG, "bad")).rejects.toMatchObject({ status: 404 });
  });

  it("marks a delivery waiting for another attempt as retrying", async () => {
    const { endpoint } = await relay.createEndpoint(ORG, {
      url: "https://d.example.com/retry",
      description: null,
      event_types: ["job.created"],
    });
    await relay.sendTest(ORG, endpoint.id, {});
    const retrying = await relay.listDeliveries(ORG, { endpointId: endpoint.id, status: "retrying" });
    expect(retrying.items[0]).toMatchObject({ status: "retrying", last_status_code: 503 });
    expect((await relay.listDeliveries(ORG, { endpointId: endpoint.id, status: "pending" })).items).toEqual(
      [],
    );
    // Turning the endpoint off moves what it was waiting for to the dead letters.
    await relay.updateEndpoint(ORG, endpoint.id, { enabled: false });
    const dead = await relay.listDeliveries(ORG, { endpointId: endpoint.id, status: "dead", cursor: "0" });
    expect(dead.items[0]).toMatchObject({ dead_reason: "endpoint_disabled" });
    await expect(relay.redeliver(ORG, dead.items[0]!.id)).rejects.toMatchObject({
      code: "endpoint_disabled",
    });
  });

  it("maps Relay delivery states", () => {
    const base = {
      id: "dlv_1",
      event_id: "evt_1",
      endpoint_id: "ep_1",
      attempts: 0,
      max_attempts: 8,
      next_attempt_at: null,
      last_status_code: null,
      last_error: null,
      dead_reason: null,
      replay_of: null,
      replayed_at: null,
      created_at: "2026-11-11T00:00:00Z",
      completed_at: null,
    };
    expect(toDelivery({ ...base, status: "pending" }).status).toBe("pending");
    expect(toDelivery({ ...base, status: "skipped" }).status).toBe("dead");
  });

  it("retires a tenant: endpoints gone, ingestion stops", async () => {
    const org = "01a1c8e0-4d23-7473-b18e-00646fb12f99";
    await relay.ensureTenant(org, "Demo");
    await relay.createEndpoint(org, {
      url: "https://e.example.com/hook",
      description: null,
      event_types: ["*"],
    });
    await relay.retireTenant(org);
    expect(await relay.listEndpoints(org)).toEqual([]);
    expect(fake.events().length).toBeGreaterThan(0);
  });
});
