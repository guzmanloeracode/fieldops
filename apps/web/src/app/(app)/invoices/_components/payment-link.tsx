"use client";
import type { Currency } from "@fieldops/shared";
import { Copy, Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { money } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { paymentLinkAction } from "../pay-actions";

type Link = { url: string; expiresAt: string; provider: "stripe" | "simulated" };

/**
 * "Copy payment link" on a sent or overdue invoice (FIN-05): gets the checkout link for the balance, copies it and
 * shows it, so it can be copied by hand when the clipboard isn't available.
 */
export function PaymentLinkButton({
  id,
  number,
  balanceMinor,
  currency,
  timeZone,
}: {
  id: string;
  number: string | null;
  balanceMinor: number;
  currency: Currency;
  timeZone: string;
}) {
  const t = useTranslations("pay.staff");
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<Link | null>(null);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <>
      <Button
        variant="outline"
        disabled={pending}
        data-testid="copy-payment-link"
        onClick={() =>
          startTransition(async () => {
            const r = await paymentLinkAction(id);
            if (!r.ok) {
              toast.error(r.error.message);
              return;
            }
            setLink(r.data);
            await copy(r.data.url);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Link2 />} {t("copyLink")}
      </Button>
      <Dialog open={link !== null} onOpenChange={(o) => (o ? null : setLink(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("linkTitle", { number: number ?? "" })}</DialogTitle>
            <DialogDescription>
              {link
                ? t("linkDescription", {
                    balance: money(balanceMinor, currency),
                    time: formatDateTime(link.expiresAt, timeZone),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payment-link">{t("linkLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="payment-link"
                readOnly
                value={link?.url ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="payment-link-url"
              />
              <Button type="button" variant="outline" onClick={() => link && copy(link.url)}>
                <Copy /> {t("copy")}
              </Button>
            </div>
            {link?.provider === "simulated" ? (
              <p className="text-muted-foreground text-sm">{t("linkTest")}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setLink(null)}>
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
