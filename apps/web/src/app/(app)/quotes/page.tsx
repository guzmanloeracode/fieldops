import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Quotes" };

/** Placeholder until the billing slice builds this page (FIN-02, FIN-03). */
export default function QuotesPage() {
  return <PageHeader title="Quotes" />;
}
