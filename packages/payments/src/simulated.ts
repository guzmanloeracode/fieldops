import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  SIMULATED_SESSION_PREFIX,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
} from "@fieldops/core";

// The simulated checkout (FIN-05, DEM-05): stands in for Stripe Checkout in the public demo until test keys exist.
// A session is a random id stored on the invoice and a link to FieldOps' own test page, /checkout/<token>. The
// token is an HMAC-SHA256 over the organization, the invoice, the session and its expiry with the app secret, so
// the page knows the tenant without a sign-in, like a hosted checkout link; the payment is accepted only while the
// session is still the invoice's open one. The page takes no card details: "Pay (test)" or "Cancel".

/** Simulated sessions last an hour (Stripe's last a day). */
export const SIMULATED_SESSION_TTL_MS = 60 * 60_000;
export const SIMULATED_CHECKOUT_PATH = "/checkout";

interface TokenPayload {
  o: string;
  i: string;
  s: string;
  /** Unix seconds. */
  e: number;
}

export interface SimulatedClaim {
  organizationId: string;
  invoiceId: string;
  sessionId: string;
  expiresAt: Date;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`fieldops-test-checkout\n${payload}`).digest("base64url");
}

export function simulatedCheckoutToken(claim: SimulatedClaim, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      o: claim.organizationId,
      i: claim.invoiceId,
      s: claim.sessionId,
      e: Math.floor(claim.expiresAt.getTime() / 1000),
    } satisfies TokenPayload),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^sim_[A-Za-z0-9_-]{16,64}$/;

/**
 * The session a test checkout link names, when its signature is valid; null otherwise. Expiry is reported, not
 * enforced here: the page shows an expired session as such, and paying checks the stored session.
 */
export function verifySimulatedCheckout(token: string, secret: string): SimulatedClaim | null {
  if (token.length > 500) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TokenPayload>;
    if (
      typeof data.o !== "string" ||
      typeof data.i !== "string" ||
      typeof data.s !== "string" ||
      typeof data.e !== "number" ||
      !UUID.test(data.o) ||
      !UUID.test(data.i) ||
      !SESSION.test(data.s)
    ) {
      return null;
    }
    return {
      organizationId: data.o,
      invoiceId: data.i,
      sessionId: data.s,
      expiresAt: new Date(data.e * 1000),
    };
  } catch {
    return null;
  }
}

export interface SimulatedOptions {
  /** Absolute base URL of the web app. */
  appUrl: string;
  /** The app secret that signs the links. */
  secret: string;
}

export function simulatedProvider(opts: SimulatedOptions): PaymentProvider {
  return {
    name: "simulated",
    async createCheckout(req: CheckoutRequest, now: Date): Promise<CheckoutSession> {
      const sessionId = `${SIMULATED_SESSION_PREFIX}${randomBytes(18).toString("base64url")}`;
      // Whole seconds, like the token, so the stored expiry and the link's agree.
      const expiresAt = new Date(Math.floor((now.getTime() + SIMULATED_SESSION_TTL_MS) / 1000) * 1000);
      const token = simulatedCheckoutToken(
        { organizationId: req.organizationId, invoiceId: req.invoiceId, sessionId, expiresAt },
        opts.secret,
      );
      const url = new URL(`${SIMULATED_CHECKOUT_PATH}/${token}`, opts.appUrl).toString();
      return { sessionId, url, expiresAt };
    },
  };
}
