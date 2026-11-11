"use server";
import { DomainError, portalBilling } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { logger } from "@/server/logger";
import { portalCheckout } from "@/server/payments";
import { runPortal } from "@/server/portal/session";

// The customer's quote decisions and invoice payments in the portal (POR-04, FIN-05). Errors come back as a code
// the page shows in the customer's words; the services check the scope and the state.

export type PortalBillingResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: "validation" | "conflict" | "unavailable" | "not_found" | "internal" };

function failure(err: unknown): PortalBillingResult<never> {
  if (err instanceof DomainError) {
    const code =
      err.code === "invalid_transition" || err.code === "precondition_failed" ? "conflict" : err.code;
    if (code === "validation" || code === "conflict" || code === "unavailable" || code === "not_found") {
      return { ok: false, code };
    }
  }
  // redirect() to the sign-in page when the session ended.
  if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_")) throw err;
  logger.error({ err }, "portal billing action failed");
  return { ok: false, code: "internal" };
}

/** Approve, or decline with a reason, a quote sent to the signed-in customer. */
export async function decideQuoteAction(
  slug: string,
  id: string,
  decision: "approve" | "decline",
  reason?: string,
): Promise<PortalBillingResult> {
  try {
    await runPortal(slug, (ctx) =>
      portalBilling.decidePortalQuote(ctx, id, decision === "approve" ? { decision } : { decision, reason }),
    );
    revalidatePath(`/portal/${slug}`, "layout");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** "Pay now": the checkout link for the invoice's balance (an open one is reused). */
export async function payInvoiceAction(
  slug: string,
  id: string,
): Promise<PortalBillingResult<{ url: string }>> {
  try {
    const link = await portalCheckout(slug, id);
    return { ok: true, url: link.url };
  } catch (err) {
    return failure(err);
  }
}
