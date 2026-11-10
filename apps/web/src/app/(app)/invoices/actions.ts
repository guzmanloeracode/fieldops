"use server";
import { invoices } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { billingContext } from "@/server/billing";
import { action, runService } from "@/server/context";

// Invoice and payment actions (FIN-03, FIN-05). The services check permissions (office roles) and the state.

function done<T>(result: T) {
  revalidatePath("/invoices", "layout");
  revalidatePath("/jobs", "layout");
  return result;
}

export async function createInvoiceAction(input: unknown) {
  const r = await action(() =>
    runService((ctx) => invoices.createInvoice(ctx, input)).then((i) => ({ id: i.id })),
  );
  return r.ok ? done(r) : r;
}

export async function updateInvoiceAction(id: string, input: unknown, version: number) {
  const r = await action(() =>
    runService((ctx) => invoices.updateInvoice(ctx, id, input, version)).then((i) => ({
      version: i.version,
    })),
  );
  return r.ok ? done(r) : r;
}

export async function sendInvoiceAction(id: string, contactId: string | null) {
  const r = await action(() =>
    runService((ctx) =>
      invoices.sendInvoice(billingContext(ctx), id, contactId ? { contact_id: contactId } : {}),
    ).then((i) => ({ number: i.number, to: i.contact?.email ?? null })),
  );
  return r.ok ? done(r) : r;
}

export async function voidInvoiceAction(id: string, reason: string) {
  const r = await action(() =>
    runService((ctx) => invoices.voidInvoice(ctx, id, { reason })).then(() => ({})),
  );
  return r.ok ? done(r) : r;
}

export async function recordPaymentAction(id: string, input: unknown) {
  const r = await action(() =>
    runService((ctx) => invoices.recordPayment(billingContext(ctx), id, input)).then((i) => ({
      status: i.status,
    })),
  );
  return r.ok ? done(r) : r;
}
