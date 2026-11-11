"use client";
import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideQuoteAction, type PortalBillingResult } from "../../billing-actions";

/** Approve or decline (with a reason) a quote, each confirmed in a dialog (POR-04). */
export function QuoteDecision({
  slug,
  id,
  number,
  orgName,
}: {
  slug: string;
  id: string;
  number: string;
  orgName: string;
}) {
  const t = useTranslations("pay.quotes");
  const te = useTranslations("pay.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"approve" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  const decide = (decision: "approve" | "decline") =>
    startTransition(async () => {
      const r: PortalBillingResult = await decideQuoteAction(slug, id, decision, reason.trim() || undefined);
      if (!r.ok) {
        if (r.code === "validation") setReasonError(true);
        else toast.error(te(r.code === "conflict" || r.code === "not_found" ? "conflict" : "generic"));
        return;
      }
      setDialog(null);
      toast.success(decision === "approve" ? t("approvedToast") : t("declinedToast"));
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setDialog("approve")} disabled={pending} data-testid="portal-approve-quote">
        <Check aria-hidden /> {t("approve")}
      </Button>
      <Button
        variant="outline"
        onClick={() => setDialog("decline")}
        disabled={pending}
        data-testid="portal-decline-quote"
      >
        <X aria-hidden /> {t("decline")}
      </Button>

      <Dialog open={dialog === "approve"} onOpenChange={(o) => setDialog(o ? "approve" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("approveTitle", { number })}</DialogTitle>
            <DialogDescription>{t("approveDescription", { org: orgName })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={() => decide("approve")} disabled={pending} data-testid="portal-approve-confirm">
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
              {t("approveConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "decline"} onOpenChange={(o) => setDialog(o ? "decline" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("declineTitle", { number })}</DialogTitle>
            <DialogDescription>{t("declineDescription", { org: orgName })}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) {
                setReasonError(true);
                return;
              }
              decide("decline");
            }}
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="decline-reason">{t("reason")}</Label>
              <Textarea
                id="decline-reason"
                value={reason}
                maxLength={1000}
                rows={3}
                required
                aria-invalid={reasonError || undefined}
                aria-describedby={reasonError ? "decline-reason-error" : undefined}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (e.target.value.trim()) setReasonError(false);
                }}
              />
              {reasonError ? (
                <p id="decline-reason-error" className="text-destructive text-sm">
                  {t("reasonRequired")}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={pending}
                data-testid="portal-decline-confirm"
              >
                {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {t("declineConfirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
