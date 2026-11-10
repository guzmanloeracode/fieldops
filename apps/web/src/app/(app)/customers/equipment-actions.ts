"use server";
import { customers } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

// Equipment at a site (CUS-03).

export async function createEquipmentAction(customerId: string, siteId: string, input: unknown) {
  const result = await action(() =>
    runService((ctx) => customers.createEquipment(ctx, siteId, input)).then((e) => ({ id: e.id })),
  );
  if (result.ok) revalidatePath(`/customers/${customerId}`);
  return result;
}

export async function updateEquipmentAction(customerId: string, id: string, input: unknown) {
  const result = await action(() =>
    runService((ctx) => customers.updateEquipment(ctx, id, input)).then((e) => ({ id: e.id })),
  );
  if (result.ok) {
    revalidatePath(`/customers/${customerId}`);
    revalidatePath(`/equipment/${id}`);
  }
  return result;
}

export async function deleteEquipmentAction(customerId: string, id: string) {
  const result = await action(() =>
    runService((ctx) => customers.deleteEquipment(ctx, id)).then(() => ({ id })),
  );
  if (result.ok) revalidatePath(`/customers/${customerId}`);
  return result;
}
