import { MAX_WEBHOOK_ENDPOINTS_PER_ORG } from "@fieldops/shared";
import { describe, expect, it } from "vitest";
import { world } from "../test/fixtures";
import { portalMemoryOf } from "../test/memory-portal";
import { memoryRelay } from "../test/memory-relay";
import { webhooksData } from "../test/memory-webhooks";
import { RelayError } from "./platform-types";
import type { TxRunner } from "./ai-types";
import * as webhooks from "./webhooks";
import type { WebhookDeps } from "./webhooks";

type World = ReturnType<typeof world>;

function setup(opts: { configured?: boolean } = {}) {
  const w = world();
  const mem = memoryRelay();
  const deps = (m = w.owner): WebhookDeps => {
    const run: TxRunner = (fn) => fn(w.ctx(m));
    return { actor: w.ctx(m).actor, run, relay: opts.configured === false ? null : mem.relay };
  };
  return { w, mem, deps, audit: () => portalMemoryOf(w.data).auditEvents };
}

async function turnOn(deps: WebhookDeps) {
  await webhooks.setEnabled(deps, { enabled: true });
}

function deadDelivery(org: string, endpointId: string, over: Record<string, unknown> = {}) {
  return {
    org,
    id: "dlv_1",
    endpoint_id: endpointId,
    event_id: "evt_a",
    event_type: null,
    status: "dead" as const,
    attempts: 8,
    max_attempts: 8,
    next_attempt_at: null,
    last_status_code: 500,
    last_error: "HTTP 500",
    dead_reason: "max_attempts",
    replay_of: null,
    replayed_at: null,
    created_at: "2026-11-11T00:00:00.000Z",
    completed_at: "2026-11-11T01:00:00.000Z",
    attempt_log: [],
    ...over,
  };
}

describe("webhook settings", () => {
  it("is for owners and admins", async () => {
    const { w, deps } = setup();
    await expect(webhooks.getSettings(deps(w.dispatcher))).rejects.toMatchObject({ code: "forbidden" });
    await expect(webhooks.listEndpoints(deps(w.tom))).rejects.toMatchObject({ code: "forbidden" });
    await expect(webhooks.getSettings(deps(w.admin))).resolves.toMatchObject({
      configured: true,
      enabled: false,
    });
  });

  it("turns on: the tenant first, then the outbox", async () => {
    const { w, mem, deps } = setup();
    const on = await webhooks.setEnabled(deps(), { enabled: true });
    expect(on).toMatchObject({ configured: true, enabled: true });
    expect(on.enabled_at).not.toBeNull();
    expect(mem.tenants.get(w.data.org.id)).toBe(w.data.org.name);
    // Already on: nothing to do.
    await webhooks.setEnabled(deps(), { enabled: true });
    expect(mem.calls.filter((c) => c === "ensureTenant")).toHaveLength(1);
    const off = await webhooks.setEnabled(deps(), { enabled: false });
    expect(off).toMatchObject({ enabled: false, enabled_at: null });
  });

  it("stays off when Relay refuses or isn't configured", async () => {
    const { w, mem, deps } = setup();
    mem.failWith(new RelayError("down", 0, "unreachable"));
    await expect(webhooks.setEnabled(deps(), { enabled: true })).rejects.toMatchObject({
      code: "unavailable",
      details: { reason: "relay_error" },
    });
    expect(webhooksData(w.data).enabledAt).toBeNull();

    const none = setup({ configured: false });
    await expect(webhooks.setEnabled(none.deps(), { enabled: true })).rejects.toMatchObject({
      code: "unavailable",
      details: { reason: "not_configured" },
    });
    await expect(webhooks.getSettings(none.deps())).resolves.toMatchObject({ configured: false });
    await expect(webhooks.listEndpoints(none.deps())).rejects.toMatchObject({ code: "unavailable" });
    // Turning off never needs Relay.
    webhooksData(none.w.data).enabledAt = new Date();
    await expect(webhooks.setEnabled(none.deps(), { enabled: false })).resolves.toMatchObject({
      enabled: false,
    });
    await expect(webhooks.setEnabled(deps(), { enabled: "yes" })).rejects.toMatchObject({
      code: "validation",
    });
  });
});

describe("endpoints", () => {
  it("needs webhooks on, validates the URL and audits without the secret", async () => {
    const { w, deps, audit } = setup();
    const input = { url: "https://hooks.example.com/x", event_types: ["job.created", "job.created"] };
    await expect(webhooks.createEndpoint(deps(), input)).rejects.toMatchObject({ code: "conflict" });
    await turnOn(deps());
    await expect(
      webhooks.createEndpoint(deps(), { ...input, url: "http://hooks.example.com/x" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      webhooks.createEndpoint(deps(), { ...input, url: "https://10.0.0.1/x" }),
    ).rejects.toMatchObject({ code: "validation" });
    const created = await webhooks.createEndpoint(deps(), { ...input, description: "" });
    expect(created).toMatchObject({ event_types: ["job.created"], description: null, secret: "whsec_1" });
    const entry = audit().at(-1);
    expect(entry).toMatchObject({ action: "webhook_endpoint.insert", entityId: created.id });
    expect(JSON.stringify(entry)).not.toContain("whsec_");
    expect((await webhooks.getEndpoint(deps(), created.id)).url).toBe(input.url);
    await expect(webhooks.getEndpoint(deps(), "ep_nope")).rejects.toMatchObject({ code: "not_found" });
    expect(w.data.org.id).toBeTruthy();
  });

  it("caps endpoints per organization", async () => {
    const { deps } = setup();
    await turnOn(deps());
    for (let i = 0; i < MAX_WEBHOOK_ENDPOINTS_PER_ORG; i++) {
      await webhooks.createEndpoint(deps(), { url: `https://h${i}.example.com/x`, event_types: ["*"] });
    }
    await expect(
      webhooks.createEndpoint(deps(), { url: "https://more.example.com/x", event_types: ["*"] }),
    ).rejects.toMatchObject({ code: "conflict", details: { limit: MAX_WEBHOOK_ENDPOINTS_PER_ORG } });
    expect(await webhooks.listEndpoints(deps())).toHaveLength(MAX_WEBHOOK_ENDPOINTS_PER_ORG);
  });

  it("keeps the public demo's endpoints on webhook.site or its own test receiver", async () => {
    const { deps } = setup();
    const sink = "https://demo.example.com/api/demo/webhook-sink";
    const demo = (): WebhookDeps => ({ ...deps(), demoSinkUrl: sink });
    await turnOn(demo());
    for (const url of [
      "https://hooks.example.com/x",
      "https://webhook.site.example.com/x",
      "https://webhook.site:8443/x",
      "https://demo.example.com/api/v1/jobs",
      "https://demo.example.com/api/demo/webhook-sink/more",
    ]) {
      await expect(webhooks.createEndpoint(demo(), { url, event_types: ["*"] })).rejects.toMatchObject({
        code: "validation",
        fields: [{ path: "url", message: webhooks.DEMO_URL_MESSAGE }],
      });
    }
    const site = await webhooks.createEndpoint(demo(), {
      url: "https://webhook.site/0b6c1c1e-demo",
      event_types: ["*"],
    });
    await webhooks.createEndpoint(demo(), { url: `${sink}?from=fieldops`, event_types: ["*"] });
    await expect(
      webhooks.updateEndpoint(demo(), site.id, { url: "https://hooks.example.com/x" }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(await webhooks.updateEndpoint(demo(), site.id, { description: "Inspector" })).toMatchObject({
      url: "https://webhook.site/0b6c1c1e-demo",
    });
    // Outside the demo any public https URL is fine.
    await webhooks.createEndpoint(deps(), { url: "https://hooks.example.com/x", event_types: ["*"] });
  });

  it("updates, rotates and deletes, each audited", async () => {
    const { deps, audit } = setup();
    await turnOn(deps());
    const ep = await webhooks.createEndpoint(deps(), { url: "https://a.example.com/x", event_types: ["*"] });
    const updated = await webhooks.updateEndpoint(deps(), ep.id, {
      enabled: false,
      event_types: ["quote.sent"],
    });
    expect(updated).toMatchObject({ enabled: false, event_types: ["quote.sent"] });
    expect(audit().at(-1)).toMatchObject({ action: "webhook_endpoint.update", after: { enabled: false } });
    const before = audit().length;
    await webhooks.updateEndpoint(deps(), ep.id, {});
    expect(audit()).toHaveLength(before);
    const rotated = await webhooks.rotateSecret(deps(), ep.id);
    expect(rotated.secret).toBe("whsec_rotated");
    expect(audit().at(-1)).toMatchObject({ after: { secret: "rotated" } });
    await webhooks.deleteEndpoint(deps(), ep.id);
    expect(audit().at(-1)).toMatchObject({ action: "webhook_endpoint.delete", after: { url: ep.url } });
    await expect(webhooks.updateEndpoint(deps(), ep.id, { enabled: true })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(webhooks.rotateSecret(deps(), ep.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(webhooks.deleteEndpoint(deps(), ep.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps Relay errors to domain errors", async () => {
    const { mem, deps } = setup();
    await turnOn(deps());
    const ep = await webhooks.createEndpoint(deps(), { url: "https://a.example.com/x", event_types: ["*"] });
    mem.failWith(
      new RelayError("must point to a public address", 422, "validation_failed", [
        { path: "url", message: "must point to a public address" },
      ]),
    );
    await expect(
      webhooks.updateEndpoint(deps(), ep.id, { url: "https://b.example.com" }),
    ).rejects.toMatchObject({
      code: "validation",
      details: { fields: [{ path: "url", message: "must point to a public address" }] },
    });
    mem.failWith(new RelayError("bad", 400, "invalid_json"));
    await expect(webhooks.listEndpoints(deps())).rejects.toMatchObject({
      code: "validation",
      details: { fields: [{ path: "url", message: "bad" }] },
    });
    mem.failWith(new RelayError("gone", 404, "not_found"));
    await expect(webhooks.listEndpoints(deps())).rejects.toMatchObject({ code: "not_found" });
    mem.failWith(new RelayError("busy", 409, "endpoint_disabled"));
    await expect(webhooks.listEndpoints(deps())).rejects.toMatchObject({
      code: "conflict",
      details: { relayCode: "endpoint_disabled" },
    });
    mem.failWith(new RelayError("slow", 429, "rate_limited"));
    await expect(webhooks.listEndpoints(deps())).rejects.toMatchObject({ code: "unavailable" });
    mem.failWith(new Error("boom") as RelayError);
    await expect(webhooks.listEndpoints(deps())).rejects.toThrow("boom");
  });
});

describe("test events and deliveries", () => {
  async function withEndpoint(s: ReturnType<typeof setup>) {
    await turnOn(s.deps());
    return webhooks.createEndpoint(s.deps(), {
      url: "https://a.example.com/x",
      event_types: ["job.created"],
    });
  }

  it("sends a test event only to an endpoint that is on", async () => {
    const s = setup();
    const ep = await withEndpoint(s);
    await expect(webhooks.sendTest(s.deps(), ep.id)).resolves.toEqual({ event_id: `evt_test_${ep.id}` });
    await webhooks.updateEndpoint(s.deps(), ep.id, { enabled: false });
    await expect(webhooks.sendTest(s.deps(), ep.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("names each delivery's event type from the outbox, then from Relay", async () => {
    const s = setup();
    const ep = await withEndpoint(s);
    const org = s.w.data.org.id;
    s.mem.deliveries.set("dlv_1", deadDelivery(org, ep.id, { id: "dlv_1", event_id: "evt_a" }));
    s.mem.deliveries.set("dlv_2", deadDelivery(org, ep.id, { id: "dlv_2", event_id: "evt_b" }));
    s.mem.deliveries.set("dlv_3", deadDelivery(org, ep.id, { id: "dlv_3", event_id: "evt_c" }));
    webhooksData(s.w.data).sentEvents.push({ relayEventId: "evt_a", type: "job.created" });
    s.mem.eventTypes.set("evt_b", "webhook.test");
    const page = await webhooks.listDeliveries(s.deps(), ep.id, { status: "dead" });
    expect(Object.fromEntries(page.items.map((d) => [d.event_id, d.event_type]))).toEqual({
      evt_a: "job.created",
      evt_b: "webhook.test",
      evt_c: null,
    });
    expect(s.mem.calls.filter((c) => c === "getEventType")).toHaveLength(2);
    await expect(webhooks.listDeliveries(s.deps(), ep.id, { limit: 0 })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(webhooks.listDeliveries(s.deps(), "ep_nope", undefined)).rejects.toMatchObject({
      code: "not_found",
    });
    const one = await webhooks.getDelivery(s.deps(), "dlv_1");
    expect(one.event_type).toBe("job.created");
    await expect(webhooks.getDelivery(s.deps(), "dlv_nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("redelivers dead deliveries only, once", async () => {
    const s = setup();
    const ep = await withEndpoint(s);
    const org = s.w.data.org.id;
    s.mem.deliveries.set("dlv_1", deadDelivery(org, ep.id));
    s.mem.deliveries.set("dlv_ok", deadDelivery(org, ep.id, { id: "dlv_ok", status: "delivered" }));
    s.mem.deliveries.set(
      "dlv_done",
      deadDelivery(org, ep.id, { id: "dlv_done", replayed_at: "2026-11-11T02:00:00Z" }),
    );
    webhooksData(s.w.data).sentEvents.push({ relayEventId: "evt_a", type: "job.created" });
    await expect(webhooks.redeliver(s.deps(), "dlv_1")).resolves.toMatchObject({
      id: "dlv_1_again",
      replay_of: "dlv_1",
      event_type: "job.created",
    });
    await expect(webhooks.redeliver(s.deps(), "dlv_ok")).rejects.toMatchObject({
      code: "conflict",
      details: { relayCode: "not_dead" },
    });
    await expect(webhooks.redeliver(s.deps(), "dlv_done")).rejects.toMatchObject({
      details: { relayCode: "already_replayed" },
    });
    await expect(webhooks.redeliver(s.deps(), "dlv_nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps a page without unknown events to one query", async () => {
    const s = setup();
    const ep = await withEndpoint(s);
    const page = await webhooks.listDeliveries(s.deps(), ep.id, {});
    expect(page).toEqual({ items: [], next_cursor: null });
  });
});

export type { World };
