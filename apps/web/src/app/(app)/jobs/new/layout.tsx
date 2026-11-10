import { can } from "@fieldops/core";
import { requireActor } from "@/server/context";
import { notFoundUnless } from "@/server/guards";

/**
 * Only roles that create jobs see the form. Runs before the loading skeleton streams, so the response can still be
 * a 404 (server/guards.ts).
 */
export default async function NewJobLayout({ children }: { children: React.ReactNode }) {
  notFoundUnless(can(await requireActor(), "jobs.create"));
  return children;
}
