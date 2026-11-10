import "server-only";
import type { BillingContext, CustomerMailer, ServiceContext, Store } from "@fieldops/core";
import { renderEmail } from "@fieldops/email";
import { env } from "@/env";

/**
 * Billing emails to customers (quotes, invoices, receipts): rendered and written to the outbox in the caller's
 * transaction through the billing repository, so an email exists only if the change it reports commits. In the
 * public demo they are stored as "captured" and show in the Demo outbox (DEM-05).
 */
export function customerMailer(store: Store): CustomerMailer {
  return {
    async send({ to, path, ...props }) {
      const rendered = await renderEmail({
        kind: "billing",
        to,
        props: { ...props, url: new URL(path, env.APP_URL).toString() },
      });
      await store.billing.queueEmail({
        toEmail: to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        kind: `billing.${props.kind}`,
        captured: env.DEMO_MODE,
      });
    },
  };
}

/** A service context that can email customers, for the quote, invoice and payment services. */
export function billingContext(ctx: ServiceContext): BillingContext {
  return { ...ctx, customerMailer: customerMailer(ctx.store) };
}
