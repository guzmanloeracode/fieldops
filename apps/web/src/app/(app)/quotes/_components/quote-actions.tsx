"use client";
import type { QuoteStatus } from "@fieldops/shared";
import { Copy, Download, Gavel, Loader2, Pencil, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { decideQuoteAction, duplicateQuoteAction, reviseQuoteAction, sendQuoteAction } from "../actions";

type Contact = { id: string; name: string; email: string };

/** What can be done with a quote in its current state (FIN-02). */
export function QuoteActions({
  id,
  number,
  status,
  contacts,
  contactId,
  jobNumber,
}: {
  id: string;
  number: string;
  status: QuoteStatus;
  /** Contacts with an email address. */
  contacts: Contact[];
  contactId: string | null;
  jobNumber: string | null;
}) {
  const t = useTranslations("billing.quote");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"send" | "decide" | null>(null);

  const run = <T,>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>,
    then: (data: T) => void,
  ) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      setDialog(null);
      then(r.data);
    });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="quote-actions">
      {status === "draft" || status === "sent" ? (
        <Button
          variant={status === "draft" ? "default" : "outline"}
          onClick={() => setDialog("send")}
          disabled={pending}
          data-testid="send-quote"
        >
          <Send /> {status === "draft" ? t("send") : t("sendAgain")}
        </Button>
      ) : null}
      {status === "sent" ? (
        <Button onClick={() => setDialog("decide")} disabled={pending} data-testid="decide-quote">
          <Gavel /> {t("recordDecision")}
        </Button>
      ) : null}
      {status === "sent" || status === "expired" ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => reviseQuoteAction(id),
              () => {
                toast.success(t("revised"));
                router.refresh();
              },
            )
          }
        >
          <Pencil /> {t("revise")}
        </Button>
      ) : null}
      {jobNumber ? (
        <Button asChild variant="outline">
          <Link href={`/jobs/${jobNumber}`} data-testid="quote-job-link">
            {t("openJob", { number: jobNumber })}
          </Link>
        </Button>
      ) : null}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () => duplicateQuoteAction(id),
            (d) => {
              toast.success(t("duplicated", { number: d.number }));
              router.push(`/quotes/${d.number}`);
            },
          )
        }
      >
        <Copy /> {t("duplicate")}
      </Button>
      <Button asChild variant="outline">
        <a href={`/api/v1/quotes/${id}/pdf`} download data-testid="quote-pdf">
          <Download /> {t("pdf")}
        </a>
      </Button>
      {pending ? (
        <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label={t("working")} />
      ) : null}

      <SendDialog
        open={dialog === "send"}
        onOpenChange={(o) => setDialog(o ? "send" : null)}
        number={number}
        contacts={contacts}
        contactId={contactId}
        pending={pending}
        onSend={(contact) =>
          run(
            () => sendQuoteAction(id, contact),
            (d) => {
              toast.success(t("sent", { email: d.to ?? "" }));
              router.refresh();
            },
          )
        }
      />
      <DecisionDialog
        open={dialog === "decide"}
        onOpenChange={(o) => setDialog(o ? "decide" : null)}
        number={number}
        pending={pending}
        onDecide={(input) =>
          run(
            () => decideQuoteAction(id, input),
            (d) => {
              toast.success(
                input.decision === "approve" ? t("approved", { job: d.jobNumber ?? "" }) : t("declined"),
              );
              router.refresh();
            },
          )
        }
      />
    </div>
  );
}

function SendDialog({
  open,
  onOpenChange,
  number,
  contacts,
  contactId,
  pending,
  onSend,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  number: string;
  contacts: Contact[];
  contactId: string | null;
  pending: boolean;
  onSend: (contactId: string | null) => void;
}) {
  const t = useTranslations("billing.quote");
  const [to, setTo] = useState((contacts.find((c) => c.id === contactId) ?? contacts[0])?.id ?? "");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sendTitle", { number })}</DialogTitle>
          <DialogDescription>{t("sendDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(to || null);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="quote-send-to">{t("sendTo")}</Label>
            <NativeSelect id="quote-send-to" value={to} onChange={(e) => setTo(e.target.value)}>
              {contacts.length === 0 ? <option value="">{t("noEmailContacts")}</option> : null}
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.email}
                </option>
              ))}
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || contacts.length === 0} data-testid="confirm-send">
              {pending ? <Loader2 className="animate-spin" /> : <Send />} {t("sendConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({
  open,
  onOpenChange,
  number,
  pending,
  onDecide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  number: string;
  pending: boolean;
  onDecide: (input: { decision: "approve" | "decline"; reason?: string }) => void;
}) {
  const t = useTranslations("billing.quote");
  const [decision, setDecision] = useState<"approve" | "decline">("approve");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("decisionTitle", { number })}</DialogTitle>
          <DialogDescription>{t("decisionDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (decision === "decline" && !reason.trim()) {
              setError(t("reasonRequired"));
              return;
            }
            setError(undefined);
            onDecide(decision === "approve" ? { decision } : { decision, reason: reason.trim() });
          }}
        >
          <RadioGroup
            value={decision}
            onValueChange={(v) => setDecision(v as "approve" | "decline")}
            aria-label={t("decision")}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="decision-approve" value="approve" />
              <Label htmlFor="decision-approve">{t("decisionApprove")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="decision-decline" value="decline" />
              <Label htmlFor="decision-decline">{t("decisionDecline")}</Label>
            </div>
          </RadioGroup>
          {decision === "decline" ? (
            <div className="space-y-1.5">
              <Label htmlFor="decline-reason">{t("reason")}</Label>
              <Textarea
                id="decline-reason"
                rows={3}
                value={reason}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "decline-reason-error" : undefined}
                onChange={(e) => setReason(e.target.value)}
              />
              <FieldError id="decline-reason-error" message={error} />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t("approveHint")}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending} data-testid="confirm-decision">
              {pending ? <Loader2 className="animate-spin" /> : null}
              {decision === "approve" ? t("confirmApprove") : t("confirmDecline")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
