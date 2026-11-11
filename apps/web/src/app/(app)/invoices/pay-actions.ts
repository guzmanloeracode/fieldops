"use server";
import { action, requireActor } from "@/server/context";
import { staffCheckout } from "@/server/payments";

/** "Copy payment link" (FIN-05): the checkout link for the invoice's balance; an open one is reused. */
export async function paymentLinkAction(id: string) {
  return action(async () => {
    const link = await staffCheckout(await requireActor(), id);
    return { url: link.url, expiresAt: link.expiresAt.toISOString(), provider: link.provider };
  });
}
