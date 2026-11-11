# ADR 021: Online payments behind a provider port, with a simulated checkout for the demo

**Status:** accepted · 2026-11-10 · implemented in 0.4

**Context.** FIN-05 lets customers pay an invoice online, with a webhook marking it paid. Stripe Checkout is the
planned provider, but the live demo has no Stripe keys yet, and the business may later need another gateway
(PRD §22). A payment arrives from outside, possibly more than once and in any order, and may come after staff
recorded the same money by hand or voided the invoice. Calling a payment provider takes up to seconds; a database
transaction held open across that call ties up a pooled connection.

**Decision.**

- A `PaymentProvider` port in `packages/core` (`createCheckout` for an invoice's balance), with the payment rules
  in `services/payments.ts`. `packages/payments` implements it twice:
  - **Stripe** (`stripe` 23.1.0): a hosted Checkout Session in payment mode for the balance, with
    `organization_id` and `invoice_id` in its metadata, so the webhook finds the tenant without a lookup table.
  - **Simulated:** a test checkout page at `/checkout/<token>` with no card fields, clearly labeled as a test.
- The provider is chosen from the environment: Stripe when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are
  both set; else the simulated checkout when `DEMO_MODE=true` or `PAYMENTS_PROVIDER=simulated`; else none, and the
  portal shows only the bank transfer instructions while staff record payments by hand. By the owner's decision of
  10 Nov 2026 the public demo uses the simulated checkout until Stripe test keys are provided.
- Opening a checkout is two short transactions with the provider call between them: the first checks the invoice
  (issued, open, with a balance) and returns the stored session if it has more than 10 minutes left; otherwise the
  provider creates one, and the second stores it on the invoice (only if it is still open). Any payment clears the
  stored session, since its amount no longer matches. Stripe gets an idempotency key made of the invoice, the
  amount, the currency and a 10-minute window, so racing requests get one session and an expiring one is never
  handed out again.
- The Stripe webhook (`POST /api/webhooks/stripe`, outside the public API) verifies the `Stripe-Signature` with
  the endpoint's secret before it reads anything, and handles `checkout.session.completed` and
  `checkout.session.async_payment_succeeded` for paid sessions it created. The payment is recorded through the
  same `applyPayment` as a manual one, as a card payment with the payment intent as `provider_ref`; a check before
  writing and a unique index on (organization, provider, reference) make a repeated or concurrent delivery record
  one payment. Answers: 200 when recorded, already recorded or ignored; 200 and an error log when a retry can't
  help (the invoice is void or already settled), because the money needs a person to refund it or record it; 500
  for anything else, so Stripe retries; 400 for a bad signature. A refused payment raises no notification yet.
- The simulated checkout follows the same path. Its link is an HMAC-SHA256 token over the organization, the
  invoice, the session and its expiry, signed with the app secret, so the page works without a sign-in like a
  hosted checkout. Sessions last an hour, and _Pay (test)_ is accepted only while the session is still the
  invoice's stored one. It is a plain form POST to `/checkout/<token>/pay` that answers 303 to the invoice in the
  portal: a server-action redirect lost the portal's session cookie, which is scoped to `/portal/<slug>`. The
  payment is recorded like a webhook's, as a card payment from provider `simulated` with the session as reference.

**Consequences.** The demo shows the whole loop (pay now, the payment recorded, owners notified, a receipt) without
a Stripe account, and turning Stripe on is configuration only. Another gateway is one more adapter and webhook
route. No connection waits on a provider, and duplicate or late webhooks are harmless. The webhook's signature
handling is tested offline with signed fixture events, never against Stripe's servers, so the first real test-mode
payment remains to be checked once keys exist. Money that arrives for a void or settled invoice is only logged
for now; a notification to the office would make it harder to miss. Webhook deliveries aren't stored, so the
Stripe dashboard is the place to replay one.
