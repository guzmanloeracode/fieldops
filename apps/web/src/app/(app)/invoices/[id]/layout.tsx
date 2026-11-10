import { invoices } from "@fieldops/core";
import { requireActor, runService } from "@/server/context";
import { foundOr404 } from "@/server/guards";

/** An invoice that doesn't exist answers 404 before the loading skeleton streams (server/guards.ts). */
export default async function InvoiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  await foundOr404(runService((ctx) => invoices.getInvoice(ctx, id), actor));
  return children;
}
