"use client";
import { CATALOG_ITEM_KINDS, type CatalogItemKind, type Currency } from "@fieldops/shared";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { fromInput, percent, toInput } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createCatalogItemAction, updateCatalogItemAction } from "./actions";

export interface CatalogItemValues {
  id: string;
  kind: CatalogItemKind;
  name: string;
  description: string | null;
  sku: string | null;
  unit: string;
  unitPriceMinor: number;
  unitCostMinor: number | null;
  taxRateBps: number | null;
}

type Errors = Partial<
  Record<"name" | "sku" | "unit" | "unit_price_minor" | "unit_cost_minor" | "tax_rate_bps", string>
>;

/** Creates or edits a part or fee (FIN-01). */
export function CatalogItemDialog({
  currency,
  taxRates,
  item,
}: {
  currency: Currency;
  taxRates: { name: string; rate_bps: number; default: boolean }[];
  item?: CatalogItemValues;
}) {
  const t = useTranslations("billing.catalog");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<CatalogItemKind>(item?.kind ?? "part");
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [sku, setSku] = useState(item?.sku ?? "");
  const [unit, setUnit] = useState(item?.unit ?? t("defaultUnit"));
  const [price, setPrice] = useState(item ? toInput(item.unitPriceMinor, currency) : "");
  const [cost, setCost] = useState(item?.unitCostMinor != null ? toInput(item.unitCostMinor, currency) : "");
  const [tax, setTax] = useState(item?.taxRateBps == null ? "" : String(item.taxRateBps));
  const [errors, setErrors] = useState<Errors>({});
  const idp = item ? `catalog-${item.id}` : "catalog-new";

  const submit = () => {
    const priceMinor = fromInput(price, currency);
    const costMinor = cost.trim() ? fromInput(cost, currency) : null;
    const next: Errors = {};
    if (!name.trim()) next.name = t("required");
    if (!unit.trim()) next.unit = t("required");
    if (priceMinor === null) next.unit_price_minor = t("invalidAmount");
    if (cost.trim() && costMinor === null) next.unit_cost_minor = t("invalidAmount");
    setErrors(next);
    if (Object.keys(next).length) return;
    const payload = {
      kind,
      name,
      description,
      sku,
      unit,
      unit_price_minor: priceMinor,
      unit_cost_minor: costMinor,
      tax_rate_bps: tax === "" ? null : Number(tax),
    };
    startTransition(async () => {
      const r = item
        ? await updateCatalogItemAction(item.id, payload)
        : await createCatalogItemAction(payload);
      if (!r.ok) {
        const fields: Errors = {};
        for (const f of r.error.fields ?? []) fields[f.path as keyof Errors] = f.message;
        setErrors(fields);
        toast.error(r.error.message);
        return;
      }
      toast.success(item ? t("updated") : t("created"));
      setOpen(false);
      if (!item) {
        setName("");
        setDescription("");
        setSku("");
        setPrice("");
        setCost("");
      }
      router.refresh();
    });
  };

  const field = (id: keyof Errors, label: string, input: React.ReactNode) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${idp}-${id}`}>{label}</Label>
      {input}
      <FieldError id={`${idp}-${id}-error`} message={errors[id]} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {item ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("editLabel", { name: item.name })}>
            <Pencil />
          </Button>
        ) : (
          <Button data-testid="new-catalog-item">
            <Plus /> {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idp}-kind`}>{t("kind")}</Label>
              <NativeSelect
                id={`${idp}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as CatalogItemKind)}
              >
                {CATALOG_ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="sm:col-span-2">
              {field(
                "name",
                t("name"),
                <Input
                  id={`${idp}-name`}
                  value={name}
                  aria-invalid={Boolean(errors.name)}
                  onChange={(e) => setName(e.target.value)}
                />,
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idp}-description`}>{t("descriptionField")}</Label>
            <Textarea
              id={`${idp}-description`}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "sku",
              t("sku"),
              <Input
                id={`${idp}-sku`}
                value={sku}
                aria-invalid={Boolean(errors.sku)}
                onChange={(e) => setSku(e.target.value)}
              />,
            )}
            {field(
              "unit",
              t("unit"),
              <Input
                id={`${idp}-unit`}
                value={unit}
                aria-invalid={Boolean(errors.unit)}
                onChange={(e) => setUnit(e.target.value)}
              />,
            )}
            {field(
              "unit_price_minor",
              t("price", { currency }),
              <Input
                id={`${idp}-unit_price_minor`}
                inputMode="decimal"
                value={price}
                aria-invalid={Boolean(errors.unit_price_minor)}
                onChange={(e) => setPrice(e.target.value)}
              />,
            )}
            {field(
              "unit_cost_minor",
              t("cost", { currency }),
              <Input
                id={`${idp}-unit_cost_minor`}
                inputMode="decimal"
                value={cost}
                aria-invalid={Boolean(errors.unit_cost_minor)}
                onChange={(e) => setCost(e.target.value)}
              />,
            )}
          </div>
          {field(
            "tax_rate_bps",
            t("tax"),
            <NativeSelect id={`${idp}-tax_rate_bps`} value={tax} onChange={(e) => setTax(e.target.value)}>
              <option value="">{t("defaultRate")}</option>
              {taxRates.map((r) => (
                <option key={`${r.name}-${r.rate_bps}`} value={r.rate_bps}>
                  {r.name} ({percent(r.rate_bps, locale)})
                </option>
              ))}
            </NativeSelect>,
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending} data-testid="save-catalog-item">
              {pending ? <Loader2 className="animate-spin" /> : null} {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CatalogActiveSwitch({ id, name, active }: { id: string; name: string; active: boolean }) {
  const t = useTranslations("billing.catalog");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={active}
        disabled={pending}
        aria-label={t("activeLabel", { name })}
        onCheckedChange={(v) =>
          startTransition(async () => {
            const r = await updateCatalogItemAction(id, { active: v });
            if (!r.ok) toast.error(r.error.message);
            router.refresh();
          })
        }
      />
      <span className="text-xs">{active ? t("active") : t("inactive")}</span>
    </div>
  );
}
