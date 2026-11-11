import "server-only";
import { NotFoundError, payments } from "@fieldops/core";
import { withStore } from "@fieldops/db";
import { verifySimulatedCheckout } from "@fieldops/payments";
import { cache } from "react";
import { db } from "@/server/db";
import { onlinePayments, simulatedSecret } from "@/server/payments";

/** The session a test checkout link names; "not found" unless the simulated checkout is on and the link is valid. */
export function testCheckoutClaim(token: string) {
  if (onlinePayments() !== "simulated") return null;
  return verifySimulatedCheckout(token, simulatedSecret());
}

/** One load per request, shared by the guard layout and the page. */
export const loadTestCheckout = cache(async (token: string) => {
  const claim = testCheckoutClaim(token);
  if (!claim) throw new NotFoundError("Checkout");
  return withStore(db, claim.organizationId, (store) => payments.testCheckout(store, new Date(), claim));
});
