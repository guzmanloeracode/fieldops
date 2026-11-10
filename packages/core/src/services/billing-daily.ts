import { REMINDER_DAYS } from "@fieldops/shared";
import { balanceOf, daysBetween, dueReminderStages } from "../domain/billing";
import {
  customerLocale,
  dateText,
  moneyText,
  portalPath,
  recipientFor,
  todayIn,
  type BillingDeps,
} from "./billing-common";
import type { BillingContext } from "./billing-types";

// The billing worker pass (FIN-02, FIN-06), one organization per call, idempotent: it runs every hour and uses
// the organization's local date, so each step happens once, soon after local midnight.

export interface BillingPassResult {
  expiredQuotes: number;
  overdueInvoices: number;
  reminders: number;
}

/**
 * Expires sent quotes past their validity date, marks sent invoices past their due date (with a balance) overdue,
 * and sends overdue reminders 3, 7 and 14 days after the due date. Each stage is recorded once per invoice
 * (`invoice_reminder`); only newly recorded stages email the bill-to contact, and when several stages are due at
 * once (reminders were just turned on) one email goes out for the latest. Nothing is recorded while reminders are
 * off, or for an invoice whose contact has no email.
 */
export async function runBillingPass(
  deps: BillingDeps & Pick<BillingContext, "customerMailer">,
): Promise<BillingPassResult> {
  const { store, now } = deps;
  const org = await store.organization.get();
  const today = todayIn(org, now);
  const expiredQuotes = (await store.billing.expireQuotes(today)).length;
  const overdueInvoices = (await store.billing.markOverdue(today)).length;
  let reminders = 0;
  if (org.settings.billing.remindersEnabled) {
    for (const c of await store.billing.reminderCandidates()) {
      const stages = dueReminderStages(c.dueDate, today, REMINDER_DAYS, c.sentStages);
      const recorded: number[] = [];
      for (const stage of stages) {
        if (await store.billing.recordReminder(c.invoiceId, stage, now)) recorded.push(stage);
      }
      if (recorded.length === 0) continue;
      const invoice = await store.billing.getInvoice(c.invoiceId);
      const to = invoice ? await recipientFor(store, invoice.customerId, invoice.contactId) : null;
      if (!invoice || !to) continue;
      const customer = await store.customers.get(invoice.customerId);
      const locale = customerLocale(customer, org);
      await deps.customerMailer?.send({
        kind: "invoice_reminder",
        to: to.email,
        contactName: to.name,
        organizationName: org.name,
        locale,
        path: portalPath(org, "invoices", invoice.id),
        number: invoice.number!,
        balance: moneyText(balanceOf(invoice), invoice.currency, locale),
        dueDate: dateText(c.dueDate, locale)!,
        daysOverdue: daysBetween(c.dueDate, today),
        paymentInstructions: org.settings.billing.paymentInstructions,
      });
      reminders += 1;
    }
  }
  return { expiredQuotes, overdueInvoices, reminders };
}
