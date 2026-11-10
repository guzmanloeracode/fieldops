import { jobs } from "@fieldops/core";
import { requireActor, runService } from "@/server/context";
import { foundOr404 } from "@/server/guards";

/**
 * A job that doesn't exist or that the actor can't see is not found. Runs before the loading skeleton streams, so
 * the response can still be a 404 (server/guards.ts).
 */
export default async function JobLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const actor = await requireActor();
  await foundOr404(runService((ctx) => jobs.getJob(ctx, number), actor));
  return children;
}
