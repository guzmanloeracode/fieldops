"use client";
import type { Currency, DiscountType, InvoiceLineInput } from "@fieldops/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import {
  customerPartiesAction,
  type CustomerOption,
  type CustomerParties,
} from "@/components/billing/actions";
import { CustomerPicker } from "@/components/billing/customer-picker";
import {
  LineEditor,
  discountInput,
  editorDiscount,
  editorLines,
  lineInputs,
  type EditorLine,
  type ServiceOption,
  type TaxRateOption,
} from "@/components/billing/line-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createInvoiceAction, updateInvoiceAction } from "../actions";

export interface InvoiceFormInitial {
  customer: CustomerOption | null;
  parties: CustomerParties | null;
  siteId: string | null;
  contactId: string | null;
  notes: string | null;
  discountType: DiscountType | null;
  discountValue: number;
  lines: InvoiceLineInput[];
  /** The completed job being invoiced. */
  jobId: string | null;
}

/** A new invoice (from a job or for a customer), or a draft being edited (FIN-03, EXP-04). */
export function InvoiceForm({
  invoice,
  initial,
  currency,
  taxRates,
  services,
}: {
  invoice?: { id: string; version: number };
  initial: InvoiceFormInitial;
  currency: Currency;
  taxRates: TaxRateOption[];
  services: ServiceOption[];
}) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customer, setCustomer] = useState<CustomerOption | null>(initial.customer);
  const [parties, setParties] = useState<CustomerParties | null>(initial.parties);
  const [siteId, setSiteId] = useState(initial.siteId ?? "");
  const [contactId, setContactId] = useState(initial.contactId ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [lines, setLines] = useState<EditorLine[]>(() => editorLines(initial.lines, currency));
  const [discount, setDiscount] = useState(() =>
    editorDiscount(initial.discountType, initial.discountValue, currency),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idp = invoice ? `invoice-${invoice.id}` : "invoice-new";
  const fixedCustomer = Boolean(invoice || initial.jobId);

  const chooseCustomer = (c: CustomerOption) => {
    setCustomer(c);
    setParties(null);
    setSiteId("");
    setContactId("");
    startTransition(async () => {
      const r = await customerPartiesAction(c.id);
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      setParties(r.data);
      setContactId(
        r.data.contacts.find((x) => x.isPrimary && x.email)?.id ??
          r.data.contacts.find((x) => x.email)?.id ??
          "",
      );
    });
  };

  const submit = () => {
    const next: Record<string, string> = {};
    if (!customer) next.customer_id = t("form.chooseCustomer");
    const parsed = lineInputs(lines, currency, {
      required: t("form.required"),
      number: t("form.number"),
      amount: t("form.amount"),
    });
    if (!parsed.ok) Object.assign(next, parsed.errors);
    const d = discountInput(discount, currency);
    if (!d) next.discount_value = t("lines.invalidDiscount");
    setErrors(next);
    if (Object.keys(next).length || !parsed.ok || !d || !customer) return;
    const payload = {
      site_id: siteId || null,
      contact_id: contactId || null,
      notes,
      ...d,
      lines: parsed.lines,
    };
    startTransition(async () => {
      const r = invoice
        ? await updateInvoiceAction(invoice.id, payload, invoice.version)
        : await createInvoiceAction({
            ...payload,
            ...(initial.jobId ? { job_id: initial.jobId } : { customer_id: customer.id }),
          });
      if (!r.ok) {
        const fields: Record<string, string> = {};
        for (const f of r.error.fields ?? []) fields[f.path] = f.message;
        setErrors(fields);
        toast.error(r.error.message);
        return;
      }
      if (invoice) {
        toast.success(t("invoice.saved"));
        router.refresh();
      } else if ("id" in r.data) {
        toast.success(t("invoice.created"));
        router.push(`/invoices/${r.data.id}`);
      }
    });
  };

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("form.billTo")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label id={`${idp}-customer-label`} htmlFor={`${idp}-customer`}>
              {t("form.customer")}
            </Label>
            {fixedCustomer ? (
              <p id={`${idp}-customer`} className="text-sm font-medium">
                {customer?.name}
              </p>
            ) : (
              <CustomerPicker
                id={`${idp}-customer`}
                labelledBy={`${idp}-customer-label`}
                value={customer}
                onChange={chooseCustomer}
                invalid={Boolean(errors.customer_id)}
              />
            )}
            <FieldError message={errors.customer_id} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-contact`}>{t("form.billToContact")}</Label>
            <NativeSelect
              id={`${idp}-contact`}
              value={contactId}
              disabled={!parties}
              aria-invalid={Boolean(errors.contact_id)}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">{t("form.noContact")}</option>
              {parties?.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` · ${c.email}` : ` · ${t("form.noEmail")}`}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={errors.contact_id} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-site`}>{t("form.siteOptional")}</Label>
            <NativeSelect
              id={`${idp}-site`}
              value={siteId}
              disabled={!parties}
              aria-invalid={Boolean(errors.site_id)}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">{t("form.noSite")}</option>
              {parties?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.line1}, {s.city}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={errors.site_id} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${idp}-notes`}>{t("form.notes")}</Label>
            <Textarea id={`${idp}-notes`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="text-muted-foreground text-xs">{t("form.invoiceNotesHint")}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("lines.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineEditor
            idPrefix={`${idp}-line`}
            currency={currency}
            taxRates={taxRates}
            services={services}
            lines={lines}
            onChange={setLines}
            discount={discount}
            onDiscountChange={setDiscount}
            errors={errors}
          />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} data-testid="save-invoice">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {invoice ? t("invoice.save") : t("invoice.create")}
        </Button>
      </div>
    </form>
  );
}
