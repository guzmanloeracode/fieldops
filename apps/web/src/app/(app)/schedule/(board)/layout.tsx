import { can } from "@fieldops/core";
import { requireActor } from "@/server/context";
import { notFoundUnless } from "@/server/guards";

/**
 * The board is for office roles. Runs before the loading skeleton streams, so the response can still be a 404
 * (server/guards.ts).
 */
export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  notFoundUnless(can(await requireActor(), "schedule.view"));
  return children;
}
