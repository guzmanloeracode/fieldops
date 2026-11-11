import { API_KEY_PATTERN, MAX_API_KEYS_PER_ORG } from "@fieldops/shared";
import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { world } from "../test/fixtures";
import * as apiKeys from "./api-keys";

describe("API keys (PLT-02)", () => {
  it("generates fo_ keys with 40 base62 characters, a 7-character prefix and a SHA-256 hash", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const k = await apiKeys.generateApiKey();
      expect(k.key).toMatch(API_KEY_PATTERN);
      expect(k.prefix).toBe(k.key.slice(0, 7));
      expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(k.hash).toBe(await apiKeys.hashApiKey(k.key));
      seen.add(k.key);
    }
    expect(seen.size).toBe(50);
    // A known vector: SHA-256("abc").
    expect(await apiKeys.hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("maps methods to scopes, with write implying read", () => {
    expect(apiKeys.scopeForMethod("GET")).toBe("read");
    expect(apiKeys.scopeForMethod("head")).toBe("read");
    expect(apiKeys.scopeForMethod("POST")).toBe("write");
    expect(apiKeys.scopeForMethod("DELETE")).toBe("write");
    expect(apiKeys.hasScope(["read"], "read")).toBe(true);
    expect(apiKeys.hasScope(["read"], "write")).toBe(false);
    expect(apiKeys.hasScope(["write"], "read")).toBe(true);
    expect(apiKeys.looksLikeApiKey("fo_" + "a".repeat(40))).toBe(true);
    expect(apiKeys.looksLikeApiKey("fo_" + "a".repeat(39))).toBe(false);
    expect(apiKeys.looksLikeApiKey("fo_" + "a".repeat(39) + "-")).toBe(false);
  });

  it("creates a key for the member, shows the secret once and stores only its hash", async () => {
    const w = world();
    const { record, key } = await apiKeys.createApiKey(w.ctx(w.owner), {
      name: " Zapier ",
      scopes: ["write"],
      expires_in_days: 90,
    });
    expect(key).toMatch(API_KEY_PATTERN);
    expect(record).toMatchObject({
      name: "Zapier",
      prefix: key.slice(0, 7),
      memberId: w.owner.id,
      memberName: "Olivia Owner",
      scopes: ["read", "write"],
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(record.expiresAt?.toISOString()).toBe("2027-02-08T09:00:00.000Z");
    const stored = w.data.platform!.apiKeys[0]!;
    expect(stored.tokenHash).toBe(await apiKeys.hashApiKey(key));
    expect(JSON.stringify(await apiKeys.listApiKeys(w.ctx(w.owner)))).not.toContain(key);

    const readOnly = await apiKeys.createApiKey(w.ctx(w.admin), { name: "BI", scopes: ["read"] });
    expect(readOnly.record.scopes).toEqual(["read"]);
    expect(readOnly.record.expiresAt).toBeNull();
  });

  it("validates input", async () => {
    const w = world();
    for (const bad of [
      { name: "", scopes: ["read"] },
      { name: "x", scopes: [] },
      { name: "x", scopes: ["admin"] },
      { name: "x", scopes: ["read"], expires_in_days: 7 },
    ]) {
      await expect(apiKeys.createApiKey(w.ctx(w.owner), bad)).rejects.toThrow(ValidationError);
    }
  });

  it("is for owners and admins only", async () => {
    const w = world();
    for (const m of [w.dispatcher, w.tom]) {
      await expect(apiKeys.createApiKey(w.ctx(m), { name: "x", scopes: ["read"] })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(apiKeys.listApiKeys(w.ctx(m))).rejects.toThrow(ForbiddenError);
    }
  });

  it("limits active keys; revoked and expired ones don't count", async () => {
    const w = world();
    const made: Awaited<ReturnType<typeof apiKeys.createApiKey>>[] = [];
    for (let i = 0; i < MAX_API_KEYS_PER_ORG; i++) {
      made.push(await apiKeys.createApiKey(w.ctx(w.owner), { name: `k${i}`, scopes: ["read"] }));
    }
    await expect(
      apiKeys.createApiKey(w.ctx(w.owner), { name: "one more", scopes: ["read"] }),
    ).rejects.toThrow(ValidationError);
    await apiKeys.revokeApiKey(w.ctx(w.owner), made[0]!.record.id);
    await apiKeys.createApiKey(w.ctx(w.owner), { name: "after revoke", scopes: ["read"] });
    w.data.platform!.apiKeys.find((k) => k.id === made[1]!.record.id)!.expiresAt = new Date(
      "2026-11-01T00:00:00Z",
    );
    await apiKeys.createApiKey(w.ctx(w.owner), { name: "after expiry", scopes: ["read"] });
  });

  it("revokes once and reports each key's state", async () => {
    const w = world();
    const { record } = await apiKeys.createApiKey(w.ctx(w.owner), { name: "CI", scopes: ["read"] });
    const now = new Date("2026-11-10T09:00:00Z");
    expect(apiKeys.apiKeyState(record, now)).toBe("active");
    const revoked = await apiKeys.revokeApiKey(w.ctx(w.admin), record.id);
    expect(revoked.revokedAt).toEqual(now);
    expect(apiKeys.apiKeyState(revoked, now)).toBe("revoked");
    // Revoking again keeps the first time.
    const again = await apiKeys.revokeApiKey(
      w.ctx(w.owner, { now: new Date("2026-11-11T00:00:00Z") }),
      record.id,
    );
    expect(again.revokedAt).toEqual(now);
    expect(apiKeys.apiKeyState({ revokedAt: null, expiresAt: now }, now)).toBe("expired");
    await expect(apiKeys.revokeApiKey(w.ctx(w.owner), "missing")).rejects.toThrow(NotFoundError);
    await expect(apiKeys.revokeApiKey(w.ctx(w.dispatcher), record.id)).rejects.toThrow(ForbiddenError);
  });
});
