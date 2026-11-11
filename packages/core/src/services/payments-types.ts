import type { Currency, Locale } from "@fieldops/shared";
import type { StoredCheckout } from "./billing-types";
import type { Store } from "./types";

// Online payments (FIN-05): the payment provider port. Stripe Checkout in production; a simulated checkout for the
// public demo until test keys exist; none ("unavailable") otherwise, when customers pay by bank transfer and staff
// record payments by hand. Implementations live in packages/payments.

export const ONLINE_PROVIDERS = ["stripe", "simulated"] as const;
export type OnlineProvider = (typeof ONLINE_PROVIDERS)[number];

/** Session ids of the simulated checkout start with this; Stripe's start with "cs_". */
export const SIMULATED_SESSION_PREFIX = "sim_";

/** What the provider is asked for: one payment of the invoice's balance, coming back to the portal invoice. */
export interface CheckoutRequest {
  organizationId: string;
  organizationName: string;
  invoiceId: string;
  invoiceNumber: string;
  /** Prefills the provider's email field. */
  customerEmail: string | null;
  amountMinor: number;
  currency: Currency;
  locale: Locale;
  successUrl: string;
  cancelUrl: string;
}

export type CheckoutSession = StoredCheckout;

export interface PaymentProvider {
  readonly name: OnlineProvider;
  /** Opens a hosted checkout session. May call the network: never call it inside a transaction. */
  createCheckout(request: CheckoutRequest, now: Date): Promise<CheckoutSession>;
}

/** A payment the provider confirmed: a verified webhook event, or the simulated checkout's "Pay (test)". */
export interface ConfirmedPayment {
  provider: OnlineProvider;
  /** The provider's id for the payment (Stripe: the payment intent; simulated: the session). Unique per provider. */
  providerRef: string;
  sessionId: string;
  organizationId: string;
  invoiceId: string;
  amountMinor: number;
  currency: Currency;
  paidAt: Date;
}

/** Runs a step in the tenant's transaction. */
export type TenantRunner = <T>(fn: (store: Store) => Promise<T>) => Promise<T>;

export interface CheckoutDeps {
  /** Null when online payments aren't set up. */
  provider: PaymentProvider | null;
  /** Absolute base URL for the success and cancel links. */
  appUrl: string;
  now: Date;
  /** Called twice, with the provider call between them, so no transaction waits on the provider. */
  run: TenantRunner;
}

/** A checkout link handed to the customer or copied by staff. */
export interface CheckoutLink extends CheckoutSession {
  provider: OnlineProvider;
  /** An open session was reused instead of creating another. */
  reused: boolean;
}
