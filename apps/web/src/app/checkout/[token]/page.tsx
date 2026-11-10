import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { money } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import { loadTestCheckout } from "./load";
import { PayForm } from "./pay-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pay.checkout");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * The simulated checkout (FIN-05, DEM-05): stands in for Stripe Checkout while the demo has no Stripe keys. It is
 * labeled as a test everywhere, asks for no card details and offers two buttons: "Pay (test)" and "Cancel".
 */
export default async function TestCheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("pay.checkout");
  const view = await loadTestCheckout(token);
  return (
    <div className="bg-muted/40 min-h-dvh px-4 py-10">
      <main className="bg-card mx-auto max-w-md space-y-6 rounded-xl border p-6 shadow-sm">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-950 ring-1 ring-amber-300 ring-inset dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800">
            <FlaskConical aria-hidden className="size-3.5" /> {t("badge")}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm" data-testid="test-checkout-notice">
            {t("notice")}
          </p>
        </div>
        <dl className="space-y-2 rounded-lg border p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("payTo")}</dt>
            <dd className="text-right font-medium">{view.organizationName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("invoice")}</dt>
            <dd className="font-mono">{view.invoiceNumber}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t pt-2">
            <dt className="text-muted-foreground">{t("amount")}</dt>
            <dd className="text-lg font-semibold tabular-nums" data-testid="test-checkout-amount">
              {money(view.amountMinor, view.currency)}
            </dd>
          </div>
        </dl>
        {view.state === "open" ? (
          <div className="space-y-2">
            <PayForm action={`/checkout/${token}/pay`} label={t("pay")} pendingLabel={t("paying")} />
            <Button asChild variant="ghost" className="w-full">
              <a href={`${view.returnPath}?payment=canceled`} data-testid="test-checkout-cancel">
                {t("cancel")}
              </a>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p role="status" className="bg-muted rounded-lg p-3 text-sm" data-testid="test-checkout-state">
              {view.state === "paid" ? t("paid") : t("expired")}
            </p>
            <Button asChild variant="outline" className="w-full">
              <a href={view.state === "paid" ? `${view.returnPath}?payment=success` : view.returnPath}>
                {t("back")}
              </a>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
