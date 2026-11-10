"use server";
import { quotes } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { billingContext } from "@/server/billing";
import { action, runService } from "@/server/context";

// Quote actions (FIN-02). The services check permissions (office roles) and the quote's state.

function done<T>(result: T) {
  revalidatePath("/quotes", "layout");
  return result;
}

export async function createQuoteAction(input: unknown) {
  const r = await action(() =>
    runService((ctx) => quotes.createQuote(ctx, input)).then((q) => ({ number: q.number })),
  );
  return r.ok ? done(r) : r;
}

export async function updateQuoteAction(id: string, input: unknown, version: number) {
  const r = await action(() =>
    runService((ctx) => quotes.updateQuote(ctx, id, input, version)).then((q) => ({ version: q.version })),
  );
  return r.ok ? done(r) : r;
}

export async function sendQuoteAction(id: string, contactId: string | null) {
  const r = await action(() =>
    runService((ctx) =>
      quotes.sendQuote(billingContext(ctx), id, contactId ? { contact_id: contactId } : {}),
    ).then((q) => ({ to: q.contact?.email ?? null })),
  );
  return r.ok ? done(r) : r;
}

export async function reviseQuoteAction(id: string) {
  const r = await action(() => runService((ctx) => quotes.reviseQuote(ctx, id)).then(() => ({})));
  return r.ok ? done(r) : r;
}

export async function decideQuoteAction(id: string, input: unknown) {
  const r = await action(() =>
    runService((ctx) => quotes.decideQuote(ctx, id, input)).then((q) => ({
      jobNumber: q.job?.number ?? null,
    })),
  );
  return r.ok ? done(r) : r;
}

export async function duplicateQuoteAction(id: string) {
  const r = await action(() =>
    runService((ctx) => quotes.duplicateQuote(ctx, id)).then((q) => ({ number: q.number })),
  );
  return r.ok ? done(r) : r;
}
