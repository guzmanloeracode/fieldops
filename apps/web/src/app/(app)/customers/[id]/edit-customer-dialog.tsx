"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { CUSTOMER_TYPES, customerUpdateSchema, type Address, type CustomerType } from "@fieldops/shared";
import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateCustomerAction } from "../actions";
import { AddressFields } from "../_components/address-fields";
import { splitTags } from "../_components/tags";

const formSchema = customerUpdateSchema
  .omit({ tags: true })
  .extend({ tags_text: z.string().max(800).optional() });
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function EditCustomerDialog({
  customer,
  defaultCountry,
}: {
  customer: {
    id: string;
    type: CustomerType;
    name: string;
    tags: string[];
    notes: string | null;
    billingAddress: Address | null;
  };
  defaultCountry: string;
}) {
  const t = useTranslations("customers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hasBilling, setHasBilling] = useState(Boolean(customer.billingAddress));
  const [pending, startTransition] = useTransition();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: customer.type,
      name: customer.name,
      tags_text: customer.tags.join(", "),
      notes: customer.notes ?? "",
      billing_address: customer.billingAddress
        ? {
            ...customer.billingAddress,
            line2: customer.billingAddress.line2 ?? "",
            region: customer.billingAddress.region ?? "",
            postal_code: customer.billingAddress.postal_code ?? "",
          }
        : { line1: "", line2: "", city: "", region: "", postal_code: "", country: defaultCountry },
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    const { tags_text, ...rest } = values;
    const payload = {
      ...rest,
      tags: splitTags(tags_text),
      billing_address: hasBilling ? rest.billing_address : null,
    };
    startTransition(async () => {
      const res = await updateCustomerAction(customer.id, payload);
      if (!res.ok) {
        for (const f of res.error.fields ?? [])
          form.setError((f.path.startsWith("tags") ? "tags_text" : f.path) as Path<FormInput>, {
            message: f.message,
          });
        toast.error(res.error.message);
        return;
      }
      toast.success(t("edit.saved"));
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil /> {t("detail.edit")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-name">{t("form.name")}</Label>
              <Input id="edit-name" aria-invalid={Boolean(errors.name)} {...form.register("name")} />
              <FieldError message={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-type">{t("form.type")}</Label>
              <NativeSelect id="edit-type" {...form.register("type")}>
                {CUSTOMER_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {t(`type.${v}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tags">{t("form.tags")}</Label>
            <Input id="edit-tags" aria-describedby="edit-tags-hint" {...form.register("tags_text")} />
            <p id="edit-tags-hint" className="text-muted-foreground text-xs">
              {t("form.tagsHint")}
            </p>
            <FieldError message={errors.tags_text?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">{t("form.notes")}</Label>
            <Textarea id="edit-notes" rows={3} {...form.register("notes")} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-has-billing"
                checked={hasBilling}
                onCheckedChange={(v) => {
                  setHasBilling(v === true);
                  if (v !== true) form.unregister("billing_address", { keepDefaultValue: true });
                }}
              />
              <Label htmlFor="edit-has-billing" className="font-normal">
                {t("form.billingSection")}
              </Label>
            </div>
            {hasBilling ? (
              <AddressFields form={form} prefix="billing_address" idPrefix="edit-billing" />
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} {t("edit.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
