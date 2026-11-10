"use client";
import { CreditCard, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { payInvoiceAction } from "../../billing-actions";

/** "Pay now" (FIN-05): opens the checkout for the balance (Stripe Checkout, or the test checkout in the demo). */
export function PayButton({ slug, id }: { slug: string; id: string }) {
  const t = useTranslations("pay.invoices");
  const te = useTranslations("pay.errors");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      disabled={pending}
      data-testid="portal-pay-now"
      onClick={() =>
        startTransition(async () => {
          const r = await payInvoiceAction(slug, id);
          if (r.ok) {
            window.location.assign(r.url);
            return;
          }
          toast.error(
            te(r.code === "unavailable" ? "unavailable" : r.code === "conflict" ? "conflict" : "generic"),
          );
        })
      }
    >
      {pending ? <Loader2 aria-hidden className="animate-spin" /> : <CreditCard aria-hidden />}
      {pending ? t("redirecting") : t("payNow")}
    </Button>
  );
}
