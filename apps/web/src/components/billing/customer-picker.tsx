"use client";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { billingCustomersAction, type CustomerOption } from "./actions";

/** Searches customers for a new quote or invoice. */
export function CustomerPicker({
  id,
  labelledBy,
  value,
  onChange,
  invalid,
}: {
  id: string;
  labelledBy: string;
  value: CustomerOption | null;
  onChange: (c: CustomerOption) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("billing.form");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      const r = await billingCustomersAction(query);
      if (r.ok) setOptions(r.data);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={labelledBy}
          aria-invalid={invalid}
          className="w-full justify-between font-normal"
          data-testid="customer-picker"
        >
          {value ? value.name : <span className="text-muted-foreground">{t("searchCustomer")}</span>}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("searchCustomer")} value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
                <Loader2 className="size-4 animate-spin" /> {t("loading")}
              </div>
            ) : (
              <CommandEmpty>{t("noCustomers")}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
