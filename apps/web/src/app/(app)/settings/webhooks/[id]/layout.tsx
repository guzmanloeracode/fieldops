import { NotFoundError, UnavailableError, webhooks } from "@fieldops/core";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/context";
import { notFoundUnless } from "@/server/guards";
import { webhookDeps } from "@/server/relay";

/**
 * An endpoint that doesn't exist, or belongs to another organization (Relay scopes it by tenant), is not found.
 * Runs before the loading skeleton streams, so the response can still be a 404 (server/guards.ts). When Relay
 * can't be reached the page says so instead.
 */
export default async function WebhookEndpointLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  notFoundUnless(/^ep_[0-9A-Za-z]{1,64}$/.test(id));
  const actor = await requireActor();
  try {
    await webhooks.getEndpoint(webhookDeps(actor), id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (!(err instanceof UnavailableError)) throw err;
  }
  return children;
}
