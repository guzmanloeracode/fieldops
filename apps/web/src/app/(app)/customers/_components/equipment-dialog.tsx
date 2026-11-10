"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { equipmentCreateSchema } from "@fieldops/shared";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
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
import { Textarea } from "@/components/ui/textarea";
import { createEquipmentAction, updateEquipmentAction } from "../equipment-actions";

type FormInput = z.input<typeof equipmentCreateSchema>;
type FormOutput = z.output<typeof equipmentCreateSchema>;

export interface EquipmentValues {
  id: string;
  type: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  installDate: string | null;
  warrantyEnd: string | null;
  notes: string | null;
}

/** Add or edit a unit at a site (CUS-03). */
export function EquipmentDialog({
  customerId,
  siteId,
  siteLabel,
  unit,
  variant = "icon",
}: {
  customerId: string;
  siteId: string;
  siteLabel: string;
  unit?: EquipmentValues;
  variant?: "icon" | "button";
}) {
  const t = useTranslations("insights.equipment");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaults: FormInput = {
    type: unit?.type ?? "",
    brand: unit?.brand ?? "",
    model: unit?.model ?? "",
    serial: unit?.serial ?? "",
    install_date: unit?.installDate ?? "",
    warranty_end: unit?.warrantyEnd ?? "",
    notes: unit?.notes ?? "",
  };
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(equipmentCreateSchema),
    defaultValues: defaults,
  });
  const idp = unit ? `eq-${unit.id}` : `eq-new-${siteId}`;
  const err = (k: keyof FormInput) => form.formState.errors[k]?.message;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = unit
        ? await updateEquipmentAction(customerId, unit.id, values)
        : await createEquipmentAction(customerId, siteId, values);
      if (!res.ok) {
        for (const f of res.error.fields ?? [])
          form.setError(f.path as Path<FormInput>, { message: f.message });
        toast.error(res.error.message);
        return;
      }
      toast.success(unit ? t("updated") : t("added"));
      setOpen(false);
      if (!unit) form.reset(defaults);
      router.refresh();
    }),
  );

  const text = (k: "type" | "brand" | "model" | "serial", label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${idp}-${k}`}>
        {label}
        {k === "type" ? (
          <span aria-hidden className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      <Input
        id={`${idp}-${k}`}
        {...form.register(k)}
        required={k === "type"}
        aria-invalid={err(k) ? true : undefined}
        aria-describedby={hint ? `${idp}-${k}-hint` : undefined}
      />
      {hint ? (
        <p id={`${idp}-${k}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <FieldError message={err(k)} />
    </div>
  );
  const date = (k: "install_date" | "warranty_end", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${idp}-${k}`}>{label}</Label>
      <Input id={`${idp}-${k}`} type="date" {...form.register(k)} aria-invalid={err(k) ? true : undefined} />
      <FieldError message={err(k)} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {unit ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("edit", { name: unit.type })}>
            <Pencil />
          </Button>
        ) : variant === "button" ? (
          <Button variant="outline" size="sm" data-testid="equipment-add">
            <Plus /> {t("add")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            data-testid="equipment-add"
            aria-label={t("addTo", { site: siteLabel })}
          >
            <Plus /> {t("add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{unit ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {text("type", t("type"), t("typeHint"))}
          <div className="grid gap-4 sm:grid-cols-2">
            {text("brand", t("brand"))}
            {text("model", t("model"))}
          </div>
          {text("serial", t("serial"))}
          <div className="grid gap-4 sm:grid-cols-2">
            {date("install_date", t("installDate"))}
            {date("warranty_end", t("warrantyEnd"))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-notes`}>{t("notes")}</Label>
            <Textarea id={`${idp}-notes`} rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} data-testid="equipment-save">
              {pending ? <Loader2 className="animate-spin" /> : null} {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
