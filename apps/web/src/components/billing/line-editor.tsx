"use client";
import { computeTotals, markedUp } from "@fieldops/core";
import {
  LINE_KINDS,
  type Currency,
  type DiscountType,
  type InvoiceLineInput,
  type LineKind,
} from "@fieldops/shared";
import { Check, Loader2, PackagePlus, Plus, Trash2, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchCatalogAction, type CatalogOption } from "./actions";
import { fromInput, money, percent, toInput } from "./money";

// The line editor of quotes and invoices (FIN-02, FIN-03, EXP-04): catalog parts and fees, services, free lines,
// quantity, unit, unit price, tax per line, a document discount, and totals computed live with the same domain
// function the server uses. Lines that bill an approved part or expense take their quantity and cost from the
// request; only the markup and description can change.

export interface EditorLine {
  key: string;
  kind: LineKind;
  description: string;
  quantity: string;
  unit: string;
  /** Unit price in major units, as typed. */
  price: string;
  taxRateBps: number;
  catalogItemId: string | null;
  serviceTypeId: string | null;
  expenseRequestId: string | null;
  unitCostMinor: number | null;
  /** Markup percent, as typed (EXP-04). */
  markup: string;
}

export interface ServiceOption {
  id: string;
  name: string;
  defaultPriceMinor: number;
  taxRateBps: number | null;
}

export interface TaxRateOption {
  name: string;
  rate_bps: number;
  default: boolean;
}

export interface Discount {
  type: DiscountType | null;
  /** As typed: a percent, or an amount in major units. */
  value: string;
}

let counter = 0;
export const lineKey = () => `line-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const defaultRate = (rates: readonly TaxRateOption[]) => rates.find((r) => r.default)?.rate_bps ?? 0;

/** Stored or prefilled lines (snake_case inputs) → editor rows. */
export function editorLines(lines: readonly InvoiceLineInput[], currency: Currency): EditorLine[] {
  return lines.map((l) => ({
    key: lineKey(),
    kind: l.kind,
    description: l.description,
    quantity: String(l.quantity),
    unit: l.unit ?? "",
    price: toInput(l.unit_price_minor, currency),
    taxRateBps: l.tax_rate_bps,
    catalogItemId: l.catalog_item_id ?? null,
    serviceTypeId: l.service_type_id ?? null,
    expenseRequestId: l.expense_request_id ?? null,
    unitCostMinor: l.unit_cost_minor ?? null,
    markup: String((l.markup_bps ?? 0) / 100),
  }));
}

export function editorDiscount(type: DiscountType | null, value: number, currency: Currency): Discount {
  if (!type) return { type: null, value: "" };
  return { type, value: type === "percent" ? String(value / 100) : toInput(value, currency) };
}

const quantityOf = (q: string) => {
  const n = Number(q.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? n : null;
};
const markupBpsOf = (m: string) => {
  const n = Number((m.trim() || "0").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) : null;
};
const unitPriceOf = (l: EditorLine, currency: Currency) =>
  l.expenseRequestId && l.unitCostMinor !== null
    ? markedUp(l.unitCostMinor, markupBpsOf(l.markup) ?? 0)
    : fromInput(l.price, currency);

/** The discount as the API takes it, or null when it's invalid. */
export function discountInput(d: Discount, currency: Currency) {
  if (!d.type) return { discount_type: null, discount_value: 0 };
  if (d.type === "percent") {
    const bps = markupBpsOf(d.value);
    return bps === null || bps > 10_000 ? null : { discount_type: d.type, discount_value: bps };
  }
  const minor = fromInput(d.value || "0", currency);
  return minor === null ? null : { discount_type: d.type, discount_value: minor };
}

/**
 * Editor rows → line inputs for the API, or the errors to show per field (keys like "lines.2.quantity"). The
 * server checks everything again.
 */
export function lineInputs(
  lines: readonly EditorLine[],
  currency: Currency,
  messages: { required: string; number: string; amount: string },
): { ok: true; lines: InvoiceLineInput[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const out: InvoiceLineInput[] = [];
  lines.forEach((l, i) => {
    const quantity = quantityOf(l.quantity);
    const price = unitPriceOf(l, currency);
    const markup = markupBpsOf(l.markup);
    if (!l.description.trim()) errors[`lines.${i}.description`] = messages.required;
    if (quantity === null) errors[`lines.${i}.quantity`] = messages.number;
    if (price === null) errors[`lines.${i}.unit_price_minor`] = messages.amount;
    if (l.expenseRequestId && markup === null) errors[`lines.${i}.markup_bps`] = messages.number;
    out.push({
      kind: l.kind,
      description: l.description.trim(),
      quantity: quantity ?? 0,
      unit: l.unit.trim() || null,
      unit_price_minor: price ?? 0,
      tax_rate_bps: l.taxRateBps,
      catalog_item_id: l.catalogItemId,
      service_type_id: l.serviceTypeId,
      expense_request_id: l.expenseRequestId,
      unit_cost_minor: l.unitCostMinor,
      markup_bps: l.expenseRequestId ? (markup ?? 0) : 0,
    });
  });
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, lines: out };
}

export function LineEditor({
  idPrefix,
  currency,
  taxRates,
  services,
  lines,
  onChange,
  discount,
  onDiscountChange,
  errors = {},
}: {
  idPrefix: string;
  currency: Currency;
  taxRates: readonly TaxRateOption[];
  services: readonly ServiceOption[];
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  discount: Discount;
  onDiscountChange: (d: Discount) => void;
  errors?: Record<string, string>;
}) {
  const t = useTranslations("billing.lines");
  const rate = defaultRate(taxRates);
  const update = (key: string, patch: Partial<EditorLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (line: Omit<EditorLine, "key">) => onChange([...lines, { ...line, key: lineKey() }]);
  const blank = {
    quantity: "1",
    unit: "",
    price: "",
    taxRateBps: rate,
    catalogItemId: null,
    serviceTypeId: null,
    expenseRequestId: null,
    unitCostMinor: null,
    markup: "0",
  };

  const amounts = lines.map((l) => ({
    quantity: quantityOf(l.quantity) ?? 0,
    unitPriceMinor: unitPriceOf(l, currency) ?? 0,
    taxRateBps: l.taxRateBps,
  }));
  const d = discountInput(discount, currency);
  const totals = computeTotals(amounts, { type: d?.discount_type ?? null, value: d?.discount_value ?? 0 });
  const rateOptions = [...taxRates];
  for (const l of lines) {
    if (!rateOptions.some((r) => r.rate_bps === l.taxRateBps)) {
      rateOptions.push({ name: percent(l.taxRateBps), rate_bps: l.taxRateBps, default: false });
    }
  }
  if (!rateOptions.some((r) => r.rate_bps === 0))
    rateOptions.push({ name: t("noTax"), rate_bps: 0, default: false });

  return (
    <div className="space-y-4" data-testid="line-editor">
      {lines.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t("empty")}
        </p>
      ) : (
        <ol className="space-y-3">
          {lines.map((l, i) => {
            const id = (field: string) => `${idPrefix}-${i}-${field}`;
            const err = (field: string) => errors[`lines.${i}.${field}`];
            const expense = Boolean(l.expenseRequestId);
            return (
              <li
                key={l.key}
                className="bg-card grid gap-3 rounded-lg border p-3 sm:grid-cols-12"
                data-testid="line"
                aria-label={t("lineLabel", { n: i + 1 })}
              >
                <div className="space-y-1 sm:col-span-3">
                  <Label htmlFor={id("kind")} className="text-muted-foreground text-xs">
                    {t("kind")}
                  </Label>
                  <NativeSelect
                    id={id("kind")}
                    value={l.kind}
                    disabled={expense}
                    onChange={(e) => update(l.key, { kind: e.target.value as LineKind })}
                  >
                    {LINE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`kinds.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1 sm:col-span-8">
                  <Label htmlFor={id("description")} className="text-muted-foreground text-xs">
                    {t("description")}
                  </Label>
                  <Input
                    id={id("description")}
                    value={l.description}
                    aria-invalid={Boolean(err("description"))}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                  />
                  <FieldError message={err("description")} />
                </div>
                <div className="flex items-end justify-end sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("remove", { n: i + 1 })}
                    onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={id("quantity")} className="text-muted-foreground text-xs">
                    {t("quantity")}
                  </Label>
                  <Input
                    id={id("quantity")}
                    inputMode="decimal"
                    value={l.quantity}
                    readOnly={expense}
                    aria-invalid={Boolean(err("quantity"))}
                    onChange={(e) => update(l.key, { quantity: e.target.value })}
                  />
                  <FieldError message={err("quantity")} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={id("unit")} className="text-muted-foreground text-xs">
                    {t("unit")}
                  </Label>
                  <Input
                    id={id("unit")}
                    value={l.unit}
                    placeholder={t("unitPlaceholder")}
                    onChange={(e) => update(l.key, { unit: e.target.value })}
                  />
                </div>
                {expense ? (
                  <div className="space-y-1 sm:col-span-3">
                    <Label htmlFor={id("markup")} className="text-muted-foreground text-xs">
                      {t("markup", { cost: money(l.unitCostMinor ?? 0, currency) })}
                    </Label>
                    <Input
                      id={id("markup")}
                      inputMode="decimal"
                      value={l.markup}
                      aria-invalid={Boolean(err("markup_bps"))}
                      onChange={(e) => update(l.key, { markup: e.target.value })}
                    />
                    <FieldError message={err("markup_bps")} />
                  </div>
                ) : (
                  <div className="space-y-1 sm:col-span-3">
                    <Label htmlFor={id("price")} className="text-muted-foreground text-xs">
                      {t("unitPrice", { currency })}
                    </Label>
                    <Input
                      id={id("price")}
                      inputMode="decimal"
                      value={l.price}
                      aria-invalid={Boolean(err("unit_price_minor"))}
                      onChange={(e) => update(l.key, { price: e.target.value })}
                    />
                    <FieldError message={err("unit_price_minor")} />
                  </div>
                )}
                <div className="space-y-1 sm:col-span-3">
                  <Label htmlFor={id("tax")} className="text-muted-foreground text-xs">
                    {t("tax")}
                  </Label>
                  <NativeSelect
                    id={id("tax")}
                    value={String(l.taxRateBps)}
                    onChange={(e) => update(l.key, { taxRateBps: Number(e.target.value) })}
                  >
                    {rateOptions.map((r) => (
                      <option key={`${r.name}-${r.rate_bps}`} value={r.rate_bps}>
                        {r.rate_bps === 0 && r.name === t("noTax")
                          ? r.name
                          : `${r.name} (${percent(r.rate_bps)})`}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col justify-end sm:col-span-2 sm:items-end">
                  <span className="text-muted-foreground text-xs">{t("amount")}</span>
                  <span className="py-2 text-sm font-medium tabular-nums" data-testid="line-net">
                    {money(totals.lines[i]?.netMinor ?? 0, currency)}
                  </span>
                </div>
                {expense ? (
                  <p className="text-muted-foreground text-xs sm:col-span-12">
                    {t("fromExpense", { price: money(unitPriceOf(l, currency) ?? 0, currency) })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <FieldError message={errors.lines} />

      <div className="flex flex-wrap gap-2">
        <CatalogPicker
          onPick={(c) =>
            add({
              ...blank,
              kind: c.kind,
              description: c.name,
              unit: c.unit,
              price: toInput(c.unitPriceMinor, currency),
              taxRateBps: c.taxRateBps ?? rate,
              catalogItemId: c.id,
            })
          }
        />
        {services.length ? (
          <ServicePicker
            services={services}
            onPick={(s) =>
              add({
                ...blank,
                kind: "service",
                description: s.name,
                price: toInput(s.defaultPriceMinor, currency),
                taxRateBps: s.taxRateBps ?? rate,
                serviceTypeId: s.id,
              })
            }
          />
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => add({ ...blank, kind: "fee", description: "" })}
          data-testid="add-line"
        >
          <Plus /> {t("addLine")}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-discount-type`}>{t("discount")}</Label>
            <NativeSelect
              id={`${idPrefix}-discount-type`}
              className="w-40"
              value={discount.type ?? ""}
              onChange={(e) =>
                onDiscountChange({
                  type: (e.target.value || null) as DiscountType | null,
                  value: discount.value,
                })
              }
            >
              <option value="">{t("discountNone")}</option>
              <option value="percent">{t("discountPercent")}</option>
              <option value="amount">{t("discountAmount", { currency })}</option>
            </NativeSelect>
          </div>
          {discount.type ? (
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-discount-value`}>
                {discount.type === "percent" ? t("discountPercentValue") : t("discountAmountValue")}
              </Label>
              <Input
                id={`${idPrefix}-discount-value`}
                className="w-32"
                inputMode="decimal"
                value={discount.value}
                aria-invalid={Boolean(errors.discount_value) || d === null}
                onChange={(e) => onDiscountChange({ ...discount, value: e.target.value })}
              />
              <FieldError
                message={errors.discount_value ?? (d === null ? t("invalidDiscount") : undefined)}
              />
            </div>
          ) : null}
        </div>
        <dl className="space-y-1 text-sm sm:justify-self-end" data-testid="totals">
          <Total label={t("subtotal")} value={money(totals.subtotalMinor, currency)} />
          {totals.discountMinor ? (
            <Total label={t("discountTotal")} value={`−${money(totals.discountMinor, currency)}`} />
          ) : null}
          <Total label={t("taxTotal")} value={money(totals.taxMinor, currency)} />
          <Total label={t("total")} value={money(totals.totalMinor, currency)} strong testId="total" />
        </dl>
      </div>
    </div>
  );
}

function Total({
  label,
  value,
  strong,
  testId,
}: {
  label: string;
  value: string;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={
        strong ? "flex justify-between gap-8 border-t pt-1 font-semibold" : "flex justify-between gap-8"
      }
    >
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function CatalogPicker({ onPick }: { onPick: (c: CatalogOption) => void }) {
  const t = useTranslations("billing.lines");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const id = setTimeout(async () => {
      const r = await searchCatalogAction(query);
      if (r.ok) setOptions(r.data);
      setLoading(false);
    }, 200);
    return () => clearTimeout(id);
  }, [query, open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="add-catalog">
          <PackagePlus /> {t("addCatalog")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("searchCatalog")} value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
                <Loader2 className="size-4 animate-spin" /> {t("loading")}
              </div>
            ) : (
              <CommandEmpty>{t("noCatalog")}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onPick(c);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check className="size-4 opacity-0" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.sku ? <span className="text-muted-foreground text-xs">{c.sku}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ServicePicker({
  services,
  onPick,
}: {
  services: readonly ServiceOption[];
  onPick: (s: ServiceOption) => void;
}) {
  const t = useTranslations("billing.lines");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="add-service">
          <Wrench /> {t("addService")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("searchService")} />
          <CommandList>
            <CommandEmpty>{t("noService")}</CommandEmpty>
            <CommandGroup>
              {services.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.name}
                  onSelect={() => {
                    onPick(s);
                    setOpen(false);
                  }}
                >
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
