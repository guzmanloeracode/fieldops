import { customers } from "@fieldops/core";
import { z } from "zod";
import { requireActor, runService } from "@/server/context";
import { foundOr404, notFoundUnless } from "@/server/guards";

/**
 * A unit that doesn't exist or whose site the actor can't see is not found. Runs before the loading skeleton
 * streams, so the response can still be a 404 (server/guards.ts).
 */
export default async function EquipmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  notFoundUnless(z.uuid().safeParse(id).success);
  const actor = await requireActor();
  await foundOr404(runService((ctx) => customers.getEquipment(ctx, id), actor));
  return children;
}
