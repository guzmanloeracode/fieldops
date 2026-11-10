import { balanceOf, isInvoiceOpen } from "../domain/billing";
import { ConflictError, NotFoundError, UnavailableError } from "../domain/errors";
import { assertCan, type Actor } from "../domain/permissions";
import { UUID, customerLocale, notFoundUnlessFound, portalPath, type BillingDeps } from "./billing-common";
import type { BillingContext, InvoiceView, StoredCheckout } from "./billing-types";
import { applyPayment } from "./invoices";
import {
  SIMULATED_SESSION_PREFIX,
  type CheckoutDeps,
  type CheckoutLink,
  type CheckoutRequest,
  type ConfirmedPayment,
  type OnlineProvider,
} from "./payments-types";
import type { PortalActor } from "./portal-types";
import { portalInvoiceView } from "./portal-billing";
import type { Store } from "./types";

// Online payments (FIN-05). A checkout session pays the balance of an issued invoice and is stored on it, so a
// second "Pay now" or "Copy payment link" reuses it until it is about to expire; any payment drops it, since its
// amount no longer matches. The provider confirms the payment (a verified webhook, or the simulated checkout),
// which records it like a manual one through applyPayment: idempotent on the provider's reference.

/** A stored session is reused while it has at least this long left. */
export const CHECKOUT_REUSE_MARGIN_MS = 10 * 60_000;

/** The provider that created a stored session, from its id. */
export function sessionProvider(sessionId: string): OnlineProvider {
  return sessionId.startsWith(SIMULATED_SESSION_PREFIX) ? "simulated" : "stripe";
}

export type CheckoutPlan =
  { kind: "reuse"; session: StoredCheckout } | { kind: "create"; request: CheckoutRequest };

/**
 * Checks that the invoice can be paid online (issued, open, with a balance) and returns the open session to
 * reuse, or what to ask the provider for: the balance, coming back to the invoice in the customer portal.
 */
export async function planCheckout(
  store: Store,
  now: Date,
  invoice: InvoiceView,
  provider: OnlineProvider,
  appUrl: string,
): Promise<CheckoutPlan> {
  if (!isInvoiceOpen(invoice.status) || balanceOf(invoice) <= 0) {
    throw new ConflictError(
      invoice.status === "paid"
        ? "This invoice is already paid"
        : `A ${invoice.status} invoice can't be paid online`,
      { status: invoice.status },
    );
  }
  const stored = await store.billing.getCheckout(invoice.id);
  if (
    stored &&
    sessionProvider(stored.sessionId) === provider &&
    stored.expiresAt.getTime() - now.getTime() > CHECKOUT_REUSE_MARGIN_MS
  ) {
    return { kind: "reuse", session: stored };
  }
  const org = await store.organization.get();
  const customer = await store.customers.get(invoice.customerId);
  const page = new URL(portalPath(org, "invoices", invoice.id), appUrl).toString();
  return {
    kind: "create",
    request: {
      organizationId: org.id,
      organizationName: org.name,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number!,
      customerEmail: invoice.contact?.email ?? null,
      amountMinor: balanceOf(invoice),
      currency: invoice.currency,
      locale: customerLocale(customer, org),
      successUrl: `${page}?payment=success`,
      cancelUrl: `${page}?payment=canceled`,
    },
  };
}

/**
 * The checkout link of an invoice: the open session, or a new one from the provider, stored on the invoice.
 * `load` loads the invoice with the caller's checks (staff permission or the portal customer's scope); it runs in
 * both transactions, so the second one sees the invoice as it is after the provider call.
 */
async function openCheckout(
  deps: CheckoutDeps,
  load: (store: Store) => Promise<InvoiceView>,
): Promise<CheckoutLink> {
  const provider = deps.provider;
  if (!provider) throw new UnavailableError("Online payments aren't set up");
  const plan = await deps.run(async (store) =>
    planCheckout(store, deps.now, await load(store), provider.name, deps.appUrl),
  );
  if (plan.kind === "reuse") return { ...plan.session, provider: provider.name, reused: true };
  const session = await provider.createCheckout(plan.request, deps.now);
  const saved = await deps.run(async (store) => {
    const invoice = await load(store);
    return store.billing.saveCheckout(invoice.id, session);
  });
  if (!saved) throw new ConflictError("The invoice changed meanwhile. Reload it and try again.");
  return { ...session, provider: provider.name, reused: false };
}

/** Staff: the payment link of an issued invoice, to send to the customer ("Copy payment link", the API). */
export async function checkoutForInvoice(
  deps: CheckoutDeps,
  actor: Pick<Actor, "role">,
  invoiceId: string,
): Promise<CheckoutLink> {
  assertCan(actor, "billing.manage");
  return openCheckout(deps, async (store) =>
    notFoundUnlessFound(UUID.test(invoiceId) ? await store.billing.getInvoice(invoiceId) : null, "Invoice"),
  );
}

/** Portal: the signed-in customer pays one of their invoices (POR-04). */
export async function checkoutForPortal(
  deps: CheckoutDeps,
  portal: PortalActor,
  invoiceId: string,
): Promise<CheckoutLink> {
  return openCheckout(deps, (store) => portalInvoiceView(store, portal, invoiceId));
}

export type PaymentDeps = BillingDeps & Pick<BillingContext, "customerMailer">;

export interface ConfirmResult {
  /** "duplicate": the provider's reference was already recorded (a repeated webhook); nothing changed. */
  outcome: "recorded" | "duplicate";
  invoice: InvoiceView;
}

/**
 * Records a payment the provider confirmed, as a card payment by the provider, once per provider reference.
 * Owners are notified and the bill-to contact gets a receipt (applyPayment). An invoice that can't take it any
 * more (paid by hand meanwhile, void, a smaller balance) is a conflict the caller reports.
 */
export async function confirmOnlinePayment(
  deps: PaymentDeps,
  payment: ConfirmedPayment,
): Promise<ConfirmResult> {
  const { store } = deps;
  const invoice = notFoundUnlessFound(
    UUID.test(payment.invoiceId) ? await store.billing.getInvoice(payment.invoiceId) : null,
    "Invoice",
  );
  if (await store.billing.findPayment(payment.provider, payment.providerRef)) {
    return { outcome: "duplicate", invoice };
  }
  if (payment.currency !== invoice.currency) {
    throw new ConflictError(`The payment is in ${payment.currency}, the invoice in ${invoice.currency}`);
  }
  const updated = await applyPayment(
    deps,
    invoice,
    {
      amountMinor: payment.amountMinor,
      method: "card",
      provider: payment.provider,
      providerRef: payment.providerRef,
      reference: null,
      note: null,
      paidAt: payment.paidAt,
    },
    { userId: null, name: null },
  );
  return { outcome: "recorded", invoice: updated };
}

// ------------------------------------------------------------------ simulated checkout

/** The session the simulated checkout page was opened for (from its signed link). */
export interface TestCheckoutClaim {
  invoiceId: string;
  sessionId: string;
}

export interface TestCheckoutView {
  /** open: can be paid; paid: this session paid it; expired: another session, expired, or the invoice closed. */
  state: "open" | "paid" | "expired";
  organizationName: string;
  invoiceNumber: string;
  amountMinor: number;
  currency: InvoiceView["currency"];
  /** The invoice in the customer portal (the success and cancel links add `?payment=…`). */
  returnPath: string;
}

async function claimedInvoice(store: Store, claim: TestCheckoutClaim): Promise<InvoiceView> {
  return notFoundUnlessFound(
    UUID.test(claim.invoiceId) ? await store.billing.getInvoice(claim.invoiceId) : null,
    "Invoice",
  );
}

function sessionOpen(stored: StoredCheckout | null, claim: TestCheckoutClaim, now: Date): boolean {
  return Boolean(
    stored && stored.sessionId === claim.sessionId && stored.expiresAt.getTime() > now.getTime(),
  );
}

/** What the simulated checkout page shows for a session. */
export async function testCheckout(
  store: Store,
  now: Date,
  claim: TestCheckoutClaim,
): Promise<TestCheckoutView> {
  const invoice = await claimedInvoice(store, claim);
  if (!invoice.number) throw new NotFoundError("Invoice");
  const org = await store.organization.get();
  const paid = await store.billing.findPayment("simulated", claim.sessionId);
  const open =
    !paid &&
    isInvoiceOpen(invoice.status) &&
    sessionOpen(await store.billing.getCheckout(invoice.id), claim, now);
  return {
    state: paid ? "paid" : open ? "open" : "expired",
    organizationName: org.name,
    invoiceNumber: invoice.number,
    amountMinor: paid ? paid.amountMinor : balanceOf(invoice),
    currency: invoice.currency,
    returnPath: portalPath(org, "invoices", invoice.id),
  };
}

/**
 * "Pay (test)" on the simulated checkout: records the balance as a card payment by the "simulated" provider, the
 * way the Stripe webhook does, while the session is the invoice's open one. Paying the same session again changes
 * nothing.
 */
export async function payTestCheckout(deps: PaymentDeps, claim: TestCheckoutClaim): Promise<ConfirmResult> {
  const invoice = await claimedInvoice(deps.store, claim);
  if (await deps.store.billing.findPayment("simulated", claim.sessionId)) {
    return { outcome: "duplicate", invoice };
  }
  if (!sessionOpen(await deps.store.billing.getCheckout(invoice.id), claim, deps.now)) {
    throw new ConflictError("This checkout has expired. Go back to the invoice to pay.");
  }
  const org = await deps.store.organization.get();
  return confirmOnlinePayment(deps, {
    provider: "simulated",
    providerRef: claim.sessionId,
    sessionId: claim.sessionId,
    organizationId: org.id,
    invoiceId: invoice.id,
    amountMinor: balanceOf(invoice),
    currency: invoice.currency,
    paidAt: deps.now,
  });
}
