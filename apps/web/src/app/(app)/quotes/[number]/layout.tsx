import { quotes } from "@fieldops/core";
import { requireActor, runService } from "@/server/context";
import { foundOr404 } from "@/server/guards";

/** A quote that doesn't exist answers 404 before the loading skeleton streams (server/guards.ts). */
export default async function QuoteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const actor = await requireActor();
  await foundOr404(runService((ctx) => quotes.getQuote(ctx, decodeURIComponent(number)), actor));
  return children;
}
