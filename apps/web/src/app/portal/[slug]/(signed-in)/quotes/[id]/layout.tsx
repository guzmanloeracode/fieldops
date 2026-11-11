import { foundOr404 } from "@/server/guards";
import { loadPortalQuote } from "./load";

/** Another customer's quote, a draft or a missing one is a 404, decided before the skeleton streams. */
export default async function PortalQuoteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  await foundOr404(loadPortalQuote(slug, id));
  return children;
}
