import type { PaymentProvider } from "@fieldops/core";
import { simulatedProvider } from "./simulated";
import { stripeProvider, type StripeCheckoutClient } from "./stripe";

// Which payment provider the app uses (FIN-05): Stripe when its keys are set; the simulated checkout when there
// are none and the app is the public demo or asks for it (PAYMENTS_PROVIDER=simulated); otherwise none, and the
// portal shows the bank transfer instructions only.

export type PaymentsMode = "stripe" | "simulated" | "unavailable";

export interface PaymentsEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYMENTS_PROVIDER?: string;
  DEMO_MODE?: boolean;
}

export function paymentsMode(env: PaymentsEnv): PaymentsMode {
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) return "stripe";
  if (env.DEMO_MODE || env.PAYMENTS_PROVIDER === "simulated") return "simulated";
  return "unavailable";
}

export interface ProviderOptions {
  appUrl: string;
  /** Signs the simulated checkout links. */
  secret: string;
  stripeClient?: StripeCheckoutClient;
}

export function createPaymentProvider(env: PaymentsEnv, opts: ProviderOptions): PaymentProvider | null {
  switch (paymentsMode(env)) {
    case "stripe":
      return stripeProvider({ secretKey: env.STRIPE_SECRET_KEY!, client: opts.stripeClient });
    case "simulated":
      return simulatedProvider({ appUrl: opts.appUrl, secret: opts.secret });
    default:
      return null;
  }
}
