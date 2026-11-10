import { createHmac } from "node:crypto";
import type { CheckoutRequest } from "@fieldops/core";
import { describe, expect, it } from "vitest";
import { createPaymentProvider, paymentsMode } from "./config";
import {
  SIMULATED_SESSION_TTL_MS,
  simulatedCheckoutToken,
  simulatedProvider,
  verifySimulatedCheckout,
} from "./simulated";

const SECRET = "test-secret-test-secret-test-secret-test";
const NOW = new Date("2026-11-10T16:00:00.250Z");
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INVOICE = "7b1e2c4a-3f5d-4e6a-9b8c-0d1e2f3a4b5c";

const request: CheckoutRequest = {
  organizationId: ORG,
  organizationName: "Acme Air & Clean",
  invoiceId: INVOICE,
  invoiceNumber: "INV-2026-0042",
  customerEmail: null,
  amountMinor: 27063,
  currency: "USD",
  locale: "en",
  successUrl: "https://fieldops.example/s",
  cancelUrl: "https://fieldops.example/c",
};

describe("simulated checkout", () => {
  it("opens an hour-long session with a signed link to the test checkout page", async () => {
    const provider = simulatedProvider({ appUrl: "https://fieldops.example", secret: SECRET });
    expect(provider.name).toBe("simulated");
    const a = await provider.createCheckout(request, NOW);
    const b = await provider.createCheckout(request, NOW);
    expect(a.sessionId).toMatch(/^sim_[A-Za-z0-9_-]{24}$/);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.expiresAt).toEqual(
      new Date(Math.floor((NOW.getTime() + SIMULATED_SESSION_TTL_MS) / 1000) * 1000),
    );
    const url = new URL(a.url);
    expect(url.origin).toBe("https://fieldops.example");
    const token = url.pathname.replace(/^\/checkout\//, "");
    expect(verifySimulatedCheckout(token, SECRET)).toEqual({
      organizationId: ORG,
      invoiceId: INVOICE,
      sessionId: a.sessionId,
      expiresAt: a.expiresAt,
    });
  });

  it("refuses links that were changed, signed with another secret or malformed", () => {
    const claim = {
      organizationId: ORG,
      invoiceId: INVOICE,
      sessionId: "sim_abcdefghijklmnopqrstuvwx",
      expiresAt: new Date("2026-11-10T17:00:00Z"),
    };
    const token = simulatedCheckoutToken(claim, SECRET);
    expect(verifySimulatedCheckout(token, SECRET)).toEqual(claim);
    expect(verifySimulatedCheckout(token, "another-secret")).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ o: ORG, i: ORG, s: claim.sessionId, e: 1 })).toString(
      "base64url",
    );
    expect(verifySimulatedCheckout(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifySimulatedCheckout(`${payload}.${sig}.x`, SECRET)).toBeNull();
    expect(verifySimulatedCheckout(`${payload}`, SECRET)).toBeNull();
    expect(verifySimulatedCheckout("x".repeat(600), SECRET)).toBeNull();
    // Valid signatures over payloads that aren't a session claim.
    for (const body of [
      "not json",
      JSON.stringify({ o: "acme", i: INVOICE, s: claim.sessionId, e: 1 }),
      JSON.stringify({ o: ORG, i: INVOICE, s: "cs_test_1", e: 1 }),
      JSON.stringify({ o: ORG, i: INVOICE, s: claim.sessionId }),
      JSON.stringify({ o: 1, i: INVOICE, s: claim.sessionId, e: 1 }),
    ]) {
      const p = Buffer.from(body).toString("base64url");
      const signed = simulatedCheckoutToken(claim, SECRET).split(".")[1]!;
      expect(verifySimulatedCheckout(`${p}.${signed}`, SECRET)).toBeNull();
      // Signed properly, it still isn't a claim.
      const good = createHmac("sha256", SECRET).update(`fieldops-test-checkout\n${p}`).digest("base64url");
      expect(verifySimulatedCheckout(`${p}.${good}`, SECRET)).toBeNull();
    }
  });
});

describe("provider choice", () => {
  it("uses Stripe with both keys, the simulated checkout in the demo or on request, otherwise none", () => {
    const keys = { STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" };
    expect(paymentsMode({ ...keys, DEMO_MODE: true })).toBe("stripe");
    expect(paymentsMode({ STRIPE_SECRET_KEY: "sk_test_1", DEMO_MODE: true })).toBe("simulated");
    expect(paymentsMode({ PAYMENTS_PROVIDER: "simulated" })).toBe("simulated");
    expect(paymentsMode({ STRIPE_WEBHOOK_SECRET: "whsec_1" })).toBe("unavailable");
    expect(paymentsMode({})).toBe("unavailable");

    const opts = { appUrl: "https://fieldops.example", secret: SECRET };
    expect(createPaymentProvider(keys, opts)?.name).toBe("stripe");
    expect(createPaymentProvider({ DEMO_MODE: true }, opts)?.name).toBe("simulated");
    expect(createPaymentProvider({}, opts)).toBeNull();
  });
});
