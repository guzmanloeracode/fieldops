import { can } from "@fieldops/core";
import { requireActor } from "@/server/context";
import { notFoundUnless } from "@/server/guards";

/** The audit log is for owners and admins (AUD-03); decided before the skeleton streams. */
export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  notFoundUnless(can(await requireActor(), "audit.view"));
  return children;
}
