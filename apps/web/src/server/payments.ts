import "server-only";
import { payments, type Actor, type CheckoutDeps, type PaymentProvider, type Store } from "@fieldops/core";
import { withStore } from "@fieldops/db";
import { createPaymentProvider, paymentsMode, type PaymentsEnv, type PaymentsMode } from "@fieldops/payments";
import { env } from "@/env";
import { customerMailer } from "@/server/billing";
import { runService } from "@/server/context";
import { db } from "@/server/db";
import { notificationMailer } from "@/server/notification-mailer";
import { requirePortal, withPortalStore } from "@/server/portal/session";
import { auditMeta, type RequestMeta } from "@/server/request-meta";

// Online payments (FIN-05) in the web app: which provider is on, the two-transaction checkout for staff and the
// portal, and the transaction that records a confirmed payment for the webhook and the simulated checkout, which
// have no signed-in user.

const paymentsEnv: PaymentsEnv = {
  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
  PAYMENTS_PROVIDER: env.PAYMENTS_PROVIDER,
  DEMO_MODE: env.DEMO_MODE,
};

/** "stripe", "simulated" or "unavailable" (no Pay button; bank transfer instructions only). */
export function onlinePayments(): PaymentsMode {
  return paymentsMode(paymentsEnv);
}

let provider: PaymentProvider | null | undefined;

export function paymentProvider(): PaymentProvider | null {
  if (provider === undefined) {
    provider = createPaymentProvider(paymentsEnv, { appUrl: env.APP_URL, secret: env.BETTER_AUTH_SECRET });
  }
  return provider;
}

/** The Stripe webhook's signing secret, only while Stripe is the provider. */
export function stripeWebhookSecret(): string | null {
  return onlinePayments() === "stripe" ? env.STRIPE_WEBHOOK_SECRET! : null;
}

/** The secret that signs simulated checkout links. */
export const simulatedSecret = () => env.BETTER_AUTH_SECRET;

function deps(run: CheckoutDeps["run"]): CheckoutDeps {
  return { provider: paymentProvider(), appUrl: env.APP_URL, now: new Date(), run };
}

/** "Copy payment link" and `POST /invoices/{id}/checkout`: each step in the member's tenant transaction. */
export function staffCheckout(actor: Actor, invoiceId: string) {
  return payments.checkoutForInvoice(
    deps((fn) => runService((ctx) => fn(ctx.store), actor)),
    actor,
    invoiceId,
  );
}

/** "Pay now" in the customer portal, for the signed-in customer. */
export async function portalCheckout(slug: string, invoiceId: string) {
  const { org, actor } = await requirePortal(slug);
  return payments.checkoutForPortal(
    deps((fn) => withPortalStore(org, (store) => fn(store))),
    actor,
    invoiceId,
  );
}

export type PaymentRunDeps = payments.PaymentDeps & { store: Store };

/**
 * Runs `fn` in an organization's transaction with the mailers a payment needs: the owners' notification and the
 * customer's receipt. For the webhook and the simulated checkout, which act for no signed-in user.
 */
export function inOrganization<T>(
  organizationId: string,
  meta: RequestMeta,
  fn: (deps: PaymentRunDeps) => Promise<T>,
): Promise<T> {
  const audit = auditMeta(meta);
  return withStore(
    db,
    organizationId,
    (store, tx) =>
      fn({
        store,
        now: new Date(),
        mailer: notificationMailer(tx, organizationId),
        customerMailer: customerMailer(store),
      }),
    { userId: null, ip: audit.ip, userAgent: audit.userAgent },
  );
}
