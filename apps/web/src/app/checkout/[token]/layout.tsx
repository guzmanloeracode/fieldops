import { foundOr404 } from "@/server/guards";
import { loadTestCheckout } from "./load";

/** An invalid link, or the simulated checkout being off, is a 404 before the skeleton streams. */
export default async function TestCheckoutLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  await foundOr404(loadTestCheckout((await params).token));
  return children;
}
