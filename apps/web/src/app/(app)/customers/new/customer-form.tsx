"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { customerCreateSchema, CUSTOMER_TYPES, siteCreateSchema, type Locale } from "@fieldops/shared";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FieldError } from "@/components/app/field-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { checkDuplicatesAction, createCustomerAction } from "../actions";
import { AddressFields } from "../_components/address-fields";
import { LocaleField, localeValue } from "../_components/locale-field";
import { SiteFields } from "../_components/site-fields";
import { splitTags } from "../_components/tags";

const formSchema = z.object({
  customer: customerCreateSchema.omit({ tags: true }).extend({ tags_text: z.string().max(800).optional() }),
  site: siteCreateSchema,
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

type Duplicate = { id: string; name: string; matchedOn: "email" | "phone" };

export function CustomerForm({ defaultCountry, orgLocale }: { defaultCountry: string; orgLocale: Locale }) {
  const t = useTranslations("customers.form");
  const tType = useTranslations("customers.type");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [billingSame, setBillingSame] = useState(true);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customer: {
        type: "residential",
        name: "",
        tags_text: "",
        notes: "",
        locale: null,
        contacts: [{ name: "", role: "", email: "", phone: "", is_primary: true }],
      },
      site: {
        label: "",
        address: { line1: "", line2: "", city: "", region: "", postal_code: "", country: defaultCountry },
        latitude: null,
        longitude: null,
        access_notes: "",
        onsite_contact_name: "",
        onsite_contact_phone: "",
      },
    },
  });
  const contacts = useFieldArray({ control: form.control, name: "customer.contacts" });
  const type = form.watch("customer.type");
  const errors = form.formState.errors;

  async function checkDuplicates() {
    const list = form.getValues("customer.contacts") ?? [];
    const emails = list.map((c) => c.email ?? "").filter(Boolean) as string[];
    const phones = list.map((c) => c.phone ?? "").filter(Boolean) as string[];
    if (!emails.length && !phones.length) {
      setDuplicates([]);
      return;
    }
    const res = await checkDuplicatesAction({ emails, phones });
    if (res.ok) setDuplicates(res.data);
  }

  function setPrimary(index: number) {
    (form.getValues("customer.contacts") ?? []).forEach((_, i) => {
      form.setValue(`customer.contacts.${i}.is_primary`, i === index, { shouldDirty: true });
    });
  }

  const onSubmit = form.handleSubmit((values) => {
    const { tags_text, ...customer } = values.customer;
    const payload = {
      customer: {
        ...customer,
        tags: splitTags(tags_text),
        billing_address: billingSame ? values.site.address : customer.billing_address,
      },
      site: values.site,
    };
    startTransition(async () => {
      const res = await createCustomerAction(payload);
      if (!res.ok) {
        for (const f of res.error.fields ?? []) {
          const path = f.path.replace(/^customer\.tags\..*/, "customer.tags_text");
          form.setError(path as Path<FormInput>, { message: f.message });
        }
        toast.error(res.error.message);
        return;
      }
      toast.success(t("created"));
      router.push(`/customers/${res.data.id}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("customerSection")}</CardTitle>
          <CardDescription>{t("customerSectionHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("type")}</legend>
            <RadioGroup
              value={type ?? "residential"}
              onValueChange={(v) => form.setValue("customer.type", v as (typeof CUSTOMER_TYPES)[number])}
              className="flex flex-wrap gap-4"
            >
              {CUSTOMER_TYPES.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <RadioGroupItem value={v} id={`type-${v}`} />
                  <Label htmlFor={`type-${v}`} className="font-normal">
                    {tType(v)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="customer-name">
              {t("name")}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </Label>
            <Input
              id="customer-name"
              autoFocus
              placeholder={
                type === "commercial" ? t("namePlaceholderCommercial") : t("namePlaceholderResidential")
              }
              aria-invalid={Boolean(errors.customer?.name)}
              {...form.register("customer.name")}
            />
            <FieldError message={errors.customer?.name?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="customer-tags">{t("tags")}</Label>
              <Input
                id="customer-tags"
                aria-describedby="customer-tags-hint"
                {...form.register("customer.tags_text")}
              />
              <p id="customer-tags-hint" className="text-muted-foreground text-xs">
                {t("tagsHint")}
              </p>
              <FieldError message={errors.customer?.tags_text?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-notes">{t("notes")}</Label>
              <Textarea id="customer-notes" rows={2} {...form.register("customer.notes")} />
            </div>
            <LocaleField
              id="customer-locale"
              orgLocale={orgLocale}
              registration={form.register("customer.locale", { setValueAs: localeValue })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("contactsSection")}</CardTitle>
          <CardDescription>{t("contactsSectionHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {contacts.fields.map((field, i) => {
            const e = errors.customer?.contacts?.[i];
            const isPrimary = form.watch(`customer.contacts.${i}.is_primary`);
            return (
              <fieldset key={field.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <legend className="text-sm font-medium">{t("contact", { index: i + 1 })}</legend>
                  {contacts.fields.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("removeContact", { index: i + 1 })}
                      onClick={() => {
                        contacts.remove(i);
                        void checkDuplicates();
                      }}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`contact-${i}-name`}>
                      {t("contactName")}
                      <span aria-hidden className="text-destructive">
                        *
                      </span>
                    </Label>
                    <Input
                      id={`contact-${i}-name`}
                      aria-invalid={Boolean(e?.name)}
                      {...form.register(`customer.contacts.${i}.name`)}
                    />
                    <FieldError message={e?.name?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`contact-${i}-role`}>{t("contactRole")}</Label>
                    <Input
                      id={`contact-${i}-role`}
                      placeholder={t("contactRolePlaceholder")}
                      {...form.register(`customer.contacts.${i}.role`)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`contact-${i}-email`}>{t("email")}</Label>
                    <Input
                      id={`contact-${i}-email`}
                      type="email"
                      autoComplete="off"
                      aria-invalid={Boolean(e?.email)}
                      {...form.register(`customer.contacts.${i}.email`, {
                        onBlur: () => void checkDuplicates(),
                      })}
                    />
                    <FieldError message={e?.email?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`contact-${i}-phone`}>{t("phone")}</Label>
                    <Input
                      id={`contact-${i}-phone`}
                      type="tel"
                      autoComplete="off"
                      {...form.register(`customer.contacts.${i}.phone`, {
                        onBlur: () => void checkDuplicates(),
                      })}
                    />
                    <FieldError message={e?.phone?.message} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`contact-${i}-primary`}
                    checked={Boolean(isPrimary)}
                    onCheckedChange={(v) => v && setPrimary(i)}
                  />
                  <Label htmlFor={`contact-${i}-primary`} className="font-normal">
                    {t("primary")}
                  </Label>
                </div>
              </fieldset>
            );
          })}
          {duplicates.length > 0 ? (
            <Alert role="status">
              <AlertTriangle aria-hidden />
              <AlertTitle>{t("duplicateTitle")}</AlertTitle>
              <AlertDescription>
                <p>{t("duplicateBody")}</p>
                <ul className="mt-1 list-disc pl-5">
                  {duplicates.map((d) => (
                    <li key={d.id}>
                      <Link href={`/customers/${d.id}`} target="_blank" className="font-medium underline">
                        {d.name}
                      </Link>{" "}
                      (
                      {t("duplicateMatch", {
                        field: d.matchedOn === "email" ? t("fieldEmail") : t("fieldPhone"),
                      })}
                      )
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {contacts.fields.length < 20 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => contacts.append({ name: "", role: "", email: "", phone: "", is_primary: false })}
            >
              <Plus /> {t("addContact")}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("siteSection")}</CardTitle>
          <CardDescription>{t("siteSectionHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SiteFields form={form} prefix="site" idPrefix="site" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("billingSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="billing-same"
              checked={billingSame}
              onCheckedChange={(v) => {
                setBillingSame(v === true);
                // A hidden billing address must not block the form.
                if (v === true) form.unregister("customer.billing_address");
              }}
            />
            <Label htmlFor="billing-same" className="font-normal">
              {t("billingSame")}
            </Label>
          </div>
          {!billingSame ? (
            <AddressFields form={form} prefix="customer.billing_address" idPrefix="billing" />
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost">
          <Link href="/customers">{t("cancel")}</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
