"use server";
import { webhooks } from "@fieldops/core";
import { revalidatePath } from "next/cache";
import { action, requireActor } from "@/server/context";
import { webhookDeps } from "@/server/relay";

// Webhook settings (PLT-03). Each action calls Relay between short transactions (server/relay.ts).

const deps = async () => webhookDeps(await requireActor());

function done<T>(result: T, ...paths: string[]): T {
  revalidatePath("/settings/webhooks");
  for (const p of paths) revalidatePath(p);
  return result;
}

export async function setWebhooksEnabledAction(enabled: boolean) {
  const res = await action(async () => webhooks.setEnabled(await deps(), { enabled }));
  return done(res);
}

export async function createEndpointAction(input: unknown) {
  const res = await action(async () => webhooks.createEndpoint(await deps(), input));
  return done(res);
}

export async function updateEndpointAction(id: string, input: unknown) {
  const res = await action(async () => webhooks.updateEndpoint(await deps(), id, input));
  return done(res, `/settings/webhooks/${id}`);
}

export async function deleteEndpointAction(id: string) {
  const res = await action(async () => webhooks.deleteEndpoint(await deps(), id));
  return done(res);
}

export async function rotateSecretAction(id: string) {
  const res = await action(async () => webhooks.rotateSecret(await deps(), id));
  return done(res, `/settings/webhooks/${id}`);
}

export async function sendTestAction(id: string) {
  const res = await action(async () => webhooks.sendTest(await deps(), id));
  return done(res, `/settings/webhooks/${id}`);
}

export async function getDeliveryAction(id: string) {
  return action(async () => webhooks.getDelivery(await deps(), id));
}

export async function redeliverAction(endpointId: string, id: string) {
  const res = await action(async () => webhooks.redeliver(await deps(), id));
  return done(res, `/settings/webhooks/${endpointId}`);
}
