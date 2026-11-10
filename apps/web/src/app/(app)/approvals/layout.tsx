import { can } from "@fieldops/core";
import { requireActor } from "@/server/context";
import { notFoundUnless } from "@/server/guards";

/**
 * The inbox is for roles that can approve at least the smaller requests (EXP-03). Runs before the loading skeleton
 * streams, so the response can still be a 404 (server/guards.ts).
 */
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  notFoundUnless(can(await requireActor(), "expenses.approve", { belowDispatcherThreshold: true }));
  return children;
}
