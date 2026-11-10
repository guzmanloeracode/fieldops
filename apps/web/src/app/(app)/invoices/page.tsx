import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Invoices" };

/** Placeholder until the billing slice builds this page (FIN-02, FIN-03). */
export default function InvoicesPage() {
  return <PageHeader title="Invoices" />;
}
