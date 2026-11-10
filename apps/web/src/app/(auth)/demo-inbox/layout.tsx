import { env } from "@/env";
import { notFoundUnless } from "@/server/guards";

/**
 * The inbox exists only in the public demo. Runs before the loading skeleton streams, so the response can still be
 * a 404 (server/guards.ts).
 */
export default function DemoInboxLayout({ children }: { children: React.ReactNode }) {
  notFoundUnless(env.DEMO_MODE);
  return children;
}
