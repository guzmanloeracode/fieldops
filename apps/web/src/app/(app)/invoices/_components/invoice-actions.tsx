"use client";
import { PAYMENT_METHODS, type Currency, type InvoiceStatus } from "@fieldops/shared";
import { Ban, Banknote, Download, Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { fromInput, toInput } from "@/components/billing/money";
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
import { Textarea } from "@/components/ui/textarea";
import { fromLocalInput } from "@/lib/format";
import { recordPaymentAction, sendInvoiceAction, voidInvoiceAction } from "../actions";

type Contact = { id: string; name: string; email: string };
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; fields?: { path: string; message: string }[] } };

/** What can be done with an invoice in its current state (FIN-03, FIN-05). */
export function InvoiceActions({
  id,
  number,
  status,
  currency,
  balanceMinor,
  hasPayments,
  contacts,
  contactId,
  today,
  timeZone,
}: {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  currency: Currency;
  balanceMinor: number;
  hasPayments: boolean;
  /** Contacts with an email address. */
  contacts: Contact[];
  contactId: string | null;
  /** Today in the organization's time zone. */
  today: string;
  timeZone: string;
}) {
  const t = useTranslations("billing.invoice");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"send" | "pay" | "void" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const open = status === "sent" || status === "overdue";

  const run = <T,>(fn: () => Promise<Result<T>>, then: (data: T) => void) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        const fields: Record<string, string> = {};
        for (const f of r.error.fields ?? []) fields[f.path] = f.message;
        setFieldErrors(fields);
        toast.error(r.error.message);
        return;
      }
      setFieldErrors({});
      setDialog(null);
      then(r.data);
    });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="invoice-actions">
      {open ? (
        <Button onClick={() => setDialog("pay")} disabled={pending} data-testid="record-payment">
          <Banknote /> {t("recordPayment")}
        </Button>
      ) : null}
      {status === "draft" || open ? (
        <Button
          variant={status === "draft" ? "default" : "outline"}
          onClick={() => setDialog("send")}
          disabled={pending}
          data-testid="send-invoice"
        >
          <Send /> {status === "draft" ? t("issue") : t("sendAgain")}
        </Button>
      ) : null}
      {(status === "draft" || open) && !hasPayments ? (
        <Button
          variant="outline"
          onClick={() => setDialog("void")}
          disabled={pending}
          data-testid="void-invoice"
        >
          <Ban /> {t("void")}
        </Button>
      ) : null}
      <Button asChild variant="outline">
        <a href={`/api/v1/invoices/${id}/pdf`} download data-testid="invoice-pdf">
          <Download /> {status === "draft" ? t("previewPdf") : t("pdf")}
        </a>
      </Button>

      <SendDialog
        open={dialog === "send"}
        onOpenChange={(o) => setDialog(o ? "send" : null)}
        draft={status === "draft"}
        number={number}
        contacts={contacts}
        contactId={contactId}
        pending={pending}
        onSend={(to) =>
          run(
            () => sendInvoiceAction(id, to),
            (d) => {
              toast.success(t("sent", { number: d.number ?? "", email: d.to ?? "" }));
              router.refresh();
            },
          )
        }
      />
      <PaymentDialog
        open={dialog === "pay"}
        onOpenChange={(o) => setDialog(o ? "pay" : null)}
        currency={currency}
        balanceMinor={balanceMinor}
        today={today}
        pending={pending}
        serverErrors={fieldErrors}
        onPay={(input) =>
          run(
            () => recordPaymentAction(id, input),
            (d) => {
              toast.success(d.status === "paid" ? t("paidInFull") : t("paymentRecorded"));
              router.refresh();
            },
          )
        }
        timeZone={timeZone}
      />
      <VoidDialog
        open={dialog === "void"}
        onOpenChange={(o) => setDialog(o ? "void" : null)}
        pending={pending}
        onVoid={(reason) =>
          run(
            () => voidInvoiceAction(id, reason),
            () => {
              toast.success(t("voided"));
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
  draft,
  number,
  contacts,
  contactId,
  pending,
  onSend,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft: boolean;
  number: string | null;
  contacts: Contact[];
  contactId: string | null;
  pending: boolean;
  onSend: (contactId: string | null) => void;
}) {
  const t = useTranslations("billing.invoice");
  const [to, setTo] = useState((contacts.find((c) => c.id === contactId) ?? contacts[0])?.id ?? "");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft ? t("issueTitle") : t("sendTitle", { number: number ?? "" })}</DialogTitle>
          <DialogDescription>{draft ? t("issueDescription") : t("sendDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(to || null);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="invoice-send-to">{t("sendTo")}</Label>
            <NativeSelect id="invoice-send-to" value={to} onChange={(e) => setTo(e.target.value)}>
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
              {pending ? <Loader2 className="animate-spin" /> : <Send />}
              {draft ? t("issueConfirm") : t("sendConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  currency,
  balanceMinor,
  today,
  timeZone,
  pending,
  serverErrors,
  onPay,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currency: Currency;
  balanceMinor: number;
  today: string;
  timeZone: string;
  pending: boolean;
  serverErrors: Record<string, string>;
  onPay: (input: Record<string, unknown>) => void;
}) {
  const t = useTranslations("billing.invoice");
  const tm = useTranslations("billing.paymentMethod");
  const [amount, setAmount] = useState(toInput(balanceMinor, currency));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const shown = { ...serverErrors, ...errors };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setAmount(toInput(balanceMinor, currency));
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("paymentTitle")}</DialogTitle>
          <DialogDescription>{t("paymentDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const minor = fromInput(amount, currency);
            const next: Record<string, string> = {};
            if (!minor) next.amount_minor = t("amountInvalid");
            if (!paidOn || paidOn > today) next.paid_at = t("dateInvalid");
            setErrors(next);
            if (Object.keys(next).length) return;
            onPay({
              amount_minor: minor,
              method,
              reference,
              ...(paidOn === today ? {} : { paid_at: fromLocalInput(`${paidOn}T12:00`, timeZone) }),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payment-amount">{t("amount", { currency })}</Label>
              <Input
                id="payment-amount"
                inputMode="decimal"
                value={amount}
                aria-invalid={Boolean(shown.amount_minor)}
                aria-describedby={shown.amount_minor ? "payment-amount-error" : undefined}
                onChange={(e) => setAmount(e.target.value)}
              />
              <FieldError id="payment-amount-error" message={shown.amount_minor} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-method">{t("method")}</Label>
              <NativeSelect
                id="payment-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as (typeof PAYMENT_METHODS)[number])}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {tm(m)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-reference">{t("reference")}</Label>
              <Input
                id="payment-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-date">{t("paidOn")}</Label>
              <Input
                id="payment-date"
                type="date"
                max={today}
                value={paidOn}
                aria-invalid={Boolean(shown.paid_at)}
                onChange={(e) => setPaidOn(e.target.value)}
              />
              <FieldError message={shown.paid_at} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} data-testid="confirm-payment">
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("savePayment")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({
  open,
  onOpenChange,
  pending,
  onVoid,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onVoid: (reason: string) => void;
}) {
  const t = useTranslations("billing.invoice");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("voidTitle")}</DialogTitle>
          <DialogDescription>{t("voidDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 3) {
              setError(t("voidReasonRequired"));
              return;
            }
            setError(undefined);
            onVoid(reason.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">{t("voidReason")}</Label>
            <Textarea
              id="void-reason"
              rows={3}
              value={reason}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "void-reason-error" : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            <FieldError id="void-reason-error" message={error} />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending} data-testid="confirm-void">
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("voidConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
