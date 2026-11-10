"use server";
import { ValidationError, customers } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

function prefixed(prefix: string, err: unknown): never {
  if (err instanceof ValidationError) {
    throw new ValidationError(
      err.message,
      err.fields.map((f) => ({ path: `${prefix}.${f.path}`, message: f.message })),
    );
  }
  throw err;
}

/** Creates the customer, their contacts and the first site in one transaction. */
export async function createCustomerAction(input: { customer: unknown; site: unknown }) {
  const result = await action(() =>
    runService(async (ctx) => {
      const created = await customers.createCustomer(ctx, input.customer).catch((e) => prefixed("customer", e));
      await customers.createSite(ctx, created.customer.id, input.site).catch((e) => prefixed("site", e));
      return { id: created.customer.id, duplicates: created.duplicates };
    }),
  );
  if (result.ok) revalidatePath("/customers");
  return result;
}

export async function checkDuplicatesAction(input: { emails: string[]; phones: string[]; excludeCustomerId?: string }) {
  return action(() =>
    runService((ctx) =>
      customers.findDuplicateCustomers(ctx, {
        emails: input.emails.slice(0, 20),
        phones: input.phones.slice(0, 20),
        excludeCustomerId: input.excludeCustomerId,
      }),
    ),
  );
}

export async function updateCustomerAction(id: string, input: unknown) {
  const result = await action(() => runService((ctx) => customers.updateCustomer(ctx, id, input)).then(() => ({ id })));
  if (result.ok) {
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }
  return result;
}

export async function deleteCustomerAction(id: string) {
  const result = await action(() => runService((ctx) => customers.deleteCustomer(ctx, id)).then(() => ({ id })));
  if (result.ok) revalidatePath("/customers");
  return result;
}

export async function createSiteAction(customerId: string, input: unknown) {
  const result = await action(() =>
    runService((ctx) => customers.createSite(ctx, customerId, input)).then((s) => ({ id: s.id })),
  );
  if (result.ok) revalidatePath(`/customers/${customerId}`);
  return result;
}

export async function updateSiteAction(customerId: string, siteId: string, input: unknown) {
  const result = await action(() =>
    runService((ctx) => customers.updateSite(ctx, siteId, input)).then((s) => ({ id: s.id })),
  );
  if (result.ok) revalidatePath(`/customers/${customerId}`);
  return result;
}
