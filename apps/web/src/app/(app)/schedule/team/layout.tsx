import { can } from "@fieldops/core";
import { requireActor } from "@/server/context";
import { notFoundUnless } from "@/server/guards";

/**
 * Team availability is for office roles that manage it. Runs before the loading skeleton streams, so the response
 * can still be a 404 (server/guards.ts).
 */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  notFoundUnless(can(await requireActor(), "availability.manage"));
  return children;
}
