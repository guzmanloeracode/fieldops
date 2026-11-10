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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createQuoteAction, updateQuoteAction } from "../actions";

export interface QuoteFormValues {
  id: string;
  version: number;
  customer: CustomerOption;
  siteId: string | null;
  contactId: string | null;
  serviceTypeId: string | null;
  title: string;
  notes: string | null;
  validUntil: string | null;
  discountType: DiscountType | null;
  discountValue: number;
  lines: InvoiceLineInput[];
}

/** Creates a quote, or edits a draft (FIN-02). */
export function QuoteForm({
  quote,
  initialCustomer,
  initialParties,
  currency,
  taxRates,
  services,
  defaultValidUntil,
}: {
  quote?: QuoteFormValues;
  initialCustomer: CustomerOption | null;
  initialParties: CustomerParties | null;
  currency: Currency;
  taxRates: TaxRateOption[];
  services: ServiceOption[];
  defaultValidUntil: string;
}) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customer, setCustomer] = useState<CustomerOption | null>(quote?.customer ?? initialCustomer);
  const [parties, setParties] = useState<CustomerParties | null>(initialParties);
  const [siteId, setSiteId] = useState(quote?.siteId ?? initialParties?.sites[0]?.id ?? "");
  const primary = (p: CustomerParties | null) =>
    p?.contacts.find((c) => c.isPrimary && c.email)?.id ?? p?.contacts.find((c) => c.email)?.id ?? "";
  const [contactId, setContactId] = useState(quote ? (quote.contactId ?? "") : primary(initialParties));
  const [serviceTypeId, setServiceTypeId] = useState(quote?.serviceTypeId ?? "");
  const [title, setTitle] = useState(quote?.title ?? "");
  const [notes, setNotes] = useState(quote?.notes ?? "");
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? defaultValidUntil);
  const [lines, setLines] = useState<EditorLine[]>(() => editorLines(quote?.lines ?? [], currency));
  const [discount, setDiscount] = useState(() =>
    editorDiscount(quote?.discountType ?? null, quote?.discountValue ?? 0, currency),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idp = quote ? `quote-${quote.id}` : "quote-new";

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
      setSiteId(r.data.sites[0]?.id ?? "");
      setContactId(primary(r.data));
    });
  };

  const submit = () => {
    const next: Record<string, string> = {};
    if (!customer) next.customer_id = t("form.chooseCustomer");
    if (!siteId) next.site_id = t("form.chooseSite");
    if (!title.trim()) next.title = t("form.required");
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
      site_id: siteId,
      contact_id: contactId || null,
      service_type_id: serviceTypeId || null,
      title: title.trim(),
      notes,
      valid_until: validUntil || undefined,
      ...d,
      lines: parsed.lines.map(
        ({ expense_request_id: _e, unit_cost_minor: _c, markup_bps: _m, ...line }) => line,
      ),
    };
    startTransition(async () => {
      const r = quote
        ? await updateQuoteAction(quote.id, payload, quote.version)
        : await createQuoteAction({ ...payload, customer_id: customer.id });
      if (!r.ok) {
        const fields: Record<string, string> = {};
        for (const f of r.error.fields ?? []) fields[f.path] = f.message;
        setErrors(fields);
        toast.error(r.error.message);
        return;
      }
      if (quote) {
        toast.success(t("quote.saved"));
        router.refresh();
      } else if ("number" in r.data) {
        toast.success(t("quote.created", { number: r.data.number }));
        router.push(`/quotes/${r.data.number}`);
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
          <CardTitle className="text-base">{t("form.details")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label id={`${idp}-customer-label`} htmlFor={`${idp}-customer`}>
              {t("form.customer")}
            </Label>
            {quote ? (
              <p id={`${idp}-customer`} className="text-sm font-medium">
                {quote.customer.name}
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
            <Label htmlFor={`${idp}-site`}>{t("form.site")}</Label>
            <NativeSelect
              id={`${idp}-site`}
              value={siteId}
              disabled={!parties}
              aria-invalid={Boolean(errors.site_id)}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">{parties ? t("form.chooseSite") : t("form.chooseCustomerFirst")}</option>
              {parties?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.line1}, {s.city}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={errors.site_id} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-contact`}>{t("form.contact")}</Label>
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
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${idp}-title`}>{t("form.title")}</Label>
            <Input
              id={`${idp}-title`}
              value={title}
              maxLength={200}
              aria-invalid={Boolean(errors.title)}
              onChange={(e) => setTitle(e.target.value)}
            />
            <FieldError message={errors.title} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-service`}>{t("form.serviceType")}</Label>
            <NativeSelect
              id={`${idp}-service`}
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
            >
              <option value="">{t("form.noServiceType")}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            <p className="text-muted-foreground text-xs">{t("form.serviceTypeHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-valid`}>{t("form.validUntil")}</Label>
            <Input
              id={`${idp}-valid`}
              type="date"
              value={validUntil}
              aria-invalid={Boolean(errors.valid_until)}
              onChange={(e) => setValidUntil(e.target.value)}
            />
            <FieldError message={errors.valid_until} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${idp}-notes`}>{t("form.notes")}</Label>
            <Textarea id={`${idp}-notes`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="text-muted-foreground text-xs">{t("form.notesHint")}</p>
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
        <Button type="submit" disabled={pending} data-testid="save-quote">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {quote ? t("quote.save") : t("quote.create")}
        </Button>
      </div>
    </form>
  );
}
