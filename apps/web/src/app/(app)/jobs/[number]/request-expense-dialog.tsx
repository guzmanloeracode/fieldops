"use client";
import { formatMoney, parseMajor } from "@fieldops/core";
import { intlLocale } from "@/lib/format";
import type { Currency, ExpenseKind } from "@fieldops/shared";
import { Camera, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { requestExpenseAction } from "../../approvals/actions";
import { confirmUploadAction, requestUploadAction } from "../actions";

type Fields = Partial<
  Record<"item" | "quantity" | "unit_cost_minor" | "reason" | "supplier" | "receipt", string>
>;

const QUANTITY = /^\d{1,5}(\.\d{1,2})?$/;

/** Uploads the receipt photo through the same presigned flow as job photos and returns its attachment id. */
async function uploadReceipt(jobId: string, file: File): Promise<string | null> {
  const req = await requestUploadAction(jobId, {
    file_name: file.name || "receipt.jpg",
    mime_type: file.type || "image/jpeg",
    size_bytes: file.size,
    kind: "photo",
    caption: "Receipt",
    with_thumbnail: false,
  });
  if (!req.ok) throw new Error(req.error.fields?.[0]?.message ?? req.error.message);
  const put = await fetch(req.data.uploadUrl, { method: "PUT", body: file, headers: req.data.headers });
  if (!put.ok) return null;
  const confirmed = await confirmUploadAction(req.data.attachmentId);
  return confirmed.ok ? req.data.attachmentId : null;
}

/** EXP-01: a phone-friendly form for a part or expense, with an optional receipt photo. */
export function RequestExpenseDialog({
  jobId,
  currency,
  autoApproveBelowMinor,
}: {
  jobId: string;
  currency: Currency;
  autoApproveBelowMinor: number;
}) {
  const t = useTranslations("expenses");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ExpenseKind>("part");
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [errors, setErrors] = useState<Fields>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const example = currency === "IDR" ? "150000" : "45.00";
  const unitMinor = unitCost.trim() ? parseMajor(unitCost, currency) : null;
  const qty = QUANTITY.test(quantity.trim()) ? Number(quantity) : null;
  const total = unitMinor !== null && unitMinor >= 0 && qty ? Math.round(unitMinor * qty) : null;

  const reset = () => {
    setKind("part");
    setItem("");
    setQuantity("1");
    setUnitCost("");
    setSupplier("");
    setReason("");
    setReceipt(null);
    setErrors({});
  };

  const submit = () => {
    const next: Fields = {};
    if (!item.trim()) next.item = t("form.itemRequired");
    if (!qty || qty <= 0) next.quantity = t("form.invalidQuantity");
    if (unitMinor === null || unitMinor < 0) next.unit_cost_minor = t("form.invalidCost", { example });
    if (reason.trim().length < 3) next.reason = t("form.reasonRequired");
    setErrors(next);
    if (Object.keys(next).length) return;
    startTransition(async () => {
      let receiptId: string | null = null;
      if (receipt) {
        try {
          receiptId = await uploadReceipt(jobId, receipt);
        } catch (err) {
          setErrors({ receipt: err instanceof Error ? err.message : t("form.uploadFailed") });
          return;
        }
        if (!receiptId) {
          setErrors({ receipt: t("form.uploadFailed") });
          return;
        }
      }
      const result = await requestExpenseAction(jobId, {
        kind,
        item,
        quantity: qty,
        unit_cost_minor: unitMinor,
        supplier,
        reason,
        receipt_attachment_id: receiptId,
      });
      if (!result.ok) {
        const fields: Fields = {};
        for (const f of result.error.fields ?? []) fields[f.path as keyof Fields] = f.message;
        setErrors(fields);
        // Field problems show next to the fields; anything else as a toast.
        if (!Object.keys(fields).length) toast.error(result.error.message);
        return;
      }
      toast.success(result.data.autoApproved ? t("form.sentApproved") : t("form.sentPending"));
      setOpen(false);
      reset();
      router.refresh();
    });
  };

  const err = (k: keyof Fields) =>
    errors[k] ? { "aria-invalid": true, "aria-describedby": `expense-${k}-error` } : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="expense-request-open">
          <Plus /> {t("section.request")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("form.title")}</DialogTitle>
          <DialogDescription>
            {t("form.description", {
              amount: formatMoney({ amountMinor: autoApproveBelowMinor, currency }, intlLocale(locale)),
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("form.kind")}</legend>
            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v as ExpenseKind)}
              className="grid grid-cols-2 gap-2"
            >
              {(["part", "expense"] as const).map((k) => (
                <label
                  key={k}
                  className="has-[[data-state=checked]]:border-primary flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"
                >
                  <RadioGroupItem value={k} /> {t(`kind.${k}`)}
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="expense-item">{t("form.item")}</Label>
            <Input
              id="expense-item"
              value={item}
              maxLength={200}
              placeholder={t("form.itemPlaceholder")}
              onChange={(e) => setItem(e.target.value)}
              {...err("item")}
            />
            <FieldError id="expense-item-error" message={errors.item} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="expense-quantity">{t("form.quantity")}</Label>
              <Input
                id="expense-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                {...err("quantity")}
              />
              <FieldError id="expense-quantity-error" message={errors.quantity} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-unit-cost">{t("form.unitCost", { currency })}</Label>
              <Input
                id="expense-unit-cost"
                inputMode="decimal"
                value={unitCost}
                placeholder={example}
                onChange={(e) => setUnitCost(e.target.value)}
                {...err("unit_cost_minor")}
              />
              <FieldError id="expense-unit_cost_minor-error" message={errors.unit_cost_minor} />
            </div>
          </div>
          <p className="text-sm" aria-live="polite">
            <span className="text-muted-foreground">{t("form.total")}: </span>
            <span className="font-semibold tabular-nums" data-testid="expense-form-total">
              {total !== null ? formatMoney({ amountMinor: total, currency }, intlLocale(locale)) : "—"}
            </span>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="expense-supplier">{t("form.supplier")}</Label>
            <Input
              id="expense-supplier"
              value={supplier}
              maxLength={120}
              placeholder={t("form.supplierPlaceholder")}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-reason">{t("form.reason")}</Label>
            <Textarea
              id="expense-reason"
              value={reason}
              maxLength={500}
              rows={2}
              placeholder={t("form.reasonPlaceholder")}
              onChange={(e) => setReason(e.target.value)}
              {...err("reason")}
            />
            <FieldError id="expense-reason-error" message={errors.reason} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("form.receiptPhoto")}</p>
            <p id="expense-receipt-hint" className="text-muted-foreground text-xs">
              {t("form.receiptHint")}
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-testid="expense-receipt-input"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            />
            {receipt ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="truncate">{receipt.name}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("form.removeReceipt")}
                  onClick={() => {
                    setReceipt(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                aria-describedby="expense-receipt-hint"
                onClick={() => fileInput.current?.click()}
              >
                <Camera /> {t("form.receiptPhoto")}
              </Button>
            )}
            <FieldError id="expense-receipt-error" message={errors.receipt} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={pending} data-testid="expense-request-submit">
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
