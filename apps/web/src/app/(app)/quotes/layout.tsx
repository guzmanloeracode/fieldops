import { can } from "@fieldops/core";
import { requireActor } from "@/server/context";
import { notFoundUnless } from "@/server/guards";

/** Quotes are for office roles (PRD §5.2). Runs before any loading skeleton streams, so a 404 stays a 404. */
export default async function QuotesLayout({ children }: { children: React.ReactNode }) {
  notFoundUnless(can(await requireActor(), "billing.manage"));
  return children;
}
