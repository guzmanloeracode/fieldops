import { foundOr404 } from "@/server/guards";
import { loadPortalInvoice } from "./load";

/** Another customer's invoice, a draft or a missing one is a 404, decided before the skeleton streams. */
export default async function PortalInvoiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  await foundOr404(loadPortalInvoice(slug, id));
  return children;
}
