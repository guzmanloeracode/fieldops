"use client";
import { PRIORITY_LABELS } from "@fieldops/core";
import { JOB_PRIORITIES, type JobPriority } from "@fieldops/shared";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fromLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createJobAction, customerSitesAction, searchCustomersAction } from "../actions";

type CustomerOption = { id: string; name: string; type?: string; siteCount?: number };
type SiteOption = { id: string; label: string; line1: string; city: string; equipment: { id: string; label: string }[] };

interface FormValues {
  title: string;
  description: string;
  service_type_id: string;
  equipment_id: string;
  priority: JobPriority;
  preferred_start: string;
  preferred_end: string;
  estimated_duration_min: string;
}

export function NewJobForm({
  timeZone,
  serviceTypes,
  initialCustomer,
}: {
  timeZone: string;
  serviceTypes: { id: string; name: string; duration: number }[];
  initialCustomer: CustomerOption | null;
}) {
  const t = useTranslations("jobs");
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerOption | null>(initialCustomer);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, setValue, watch } = useForm<FormValues>({
    defaultValues: { priority: "normal", title: "", description: "", service_type_id: "", equipment_id: "", preferred_start: "", preferred_end: "", estimated_duration_min: "" },
  });

  useEffect(() => {
    setSites([]);
    setSiteId("");
    if (!customer) return;
    void customerSitesAction(customer.id).then((r) => {
      if (r.ok) {
        setSites(r.data);
        if (r.data.length === 1) setSiteId(r.data[0]!.id);
      }
    });
  }, [customer]);

  const site = sites.find((s) => s.id === siteId);

  const onSubmit = handleSubmit((v) => {
    const errors: Record<string, string> = {};
    if (!customer) errors.customer_id = t("new.errors.customer");
    if (!siteId) errors.site_id = t("new.errors.site");
    if (!v.title.trim()) errors.title = t("new.errors.title");
    setServerErrors(errors);
    if (Object.keys(errors).length) return;
    startTransition(async () => {
      const result = await createJobAction({
        customer_id: customer!.id,
        site_id: siteId,
        equipment_id: v.equipment_id || null,
        service_type_id: v.service_type_id || null,
        title: v.title,
        description: v.description,
        priority: v.priority,
        source: "manual",
        preferred_start: fromLocalInput(v.preferred_start, timeZone),
        preferred_end: fromLocalInput(v.preferred_end, timeZone),
        estimated_duration_min: v.estimated_duration_min ? Number(v.estimated_duration_min) : null,
      });
      if (!result.ok) {
        setServerErrors(Object.fromEntries((result.error.fields ?? []).map((f) => [f.path, f.message])));
        toast.error(result.error.message);
        return;
      }
      toast.success(t("new.created", { number: result.data.number }));
      router.push(`/jobs/${result.data.number}`);
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("new.where")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label id="customer-label">{t("new.customer")}</Label>
            <CustomerPicker value={customer} onChange={setCustomer} />
            <FieldError message={serverErrors.customer_id} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="site">{t("new.site")}</Label>
            <Select value={siteId} onValueChange={setSiteId} disabled={!customer || sites.length === 0}>
              <SelectTrigger id="site" className="w-full">
                <SelectValue placeholder={customer ? t("new.chooseSite") : t("new.chooseCustomerFirst")} />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label} · {s.line1}, {s.city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={serverErrors.site_id} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipment">{t("new.equipment")}</Label>
            <Select value={watch("equipment_id") || "none"} onValueChange={(v) => setValue("equipment_id", v === "none" ? "" : v)} disabled={!site?.equipment.length}>
              <SelectTrigger id="equipment" className="w-full">
                <SelectValue placeholder={t("new.noEquipment")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("new.noEquipment")}</SelectItem>
                {site?.equipment.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("new.what")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="service_type">{t("col.serviceType")}</Label>
            <Select
              value={watch("service_type_id") || "none"}
              onValueChange={(v) => {
                const id = v === "none" ? "" : v;
                setValue("service_type_id", id);
                const st = serviceTypes.find((s) => s.id === id);
                if (st && !watch("estimated_duration_min")) setValue("estimated_duration_min", String(st.duration));
                if (st && !watch("title")) setValue("title", st.name);
              }}
            >
              <SelectTrigger id="service_type" className="w-full">
                <SelectValue placeholder={t("new.chooseServiceType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("new.noServiceType")}</SelectItem>
                {serviceTypes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimated_duration_min">{t("new.duration")}</Label>
            <Input id="estimated_duration_min" type="number" min={5} max={1440} step={5} inputMode="numeric" {...register("estimated_duration_min")} />
            <FieldError message={serverErrors.estimated_duration_min} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="title">{t("new.jobTitle")}</Label>
            <Input id="title" maxLength={200} aria-invalid={Boolean(serverErrors.title)} {...register("title")} />
            <FieldError message={serverErrors.title} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">{t("new.descriptionLabel")}</Label>
            <Textarea id="description" rows={4} maxLength={8000} placeholder={t("new.descriptionPlaceholder")} {...register("description")} />
          </div>
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">{t("col.priority")}</legend>
            <RadioGroup value={watch("priority")} onValueChange={(v) => setValue("priority", v as JobPriority)} className="flex flex-wrap gap-2">
              {JOB_PRIORITIES.map((p) => (
                <label
                  key={p}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                    watch("priority") === p && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem value={p} />
                  {PRIORITY_LABELS[p]}
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("new.when")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="preferred_start">{t("new.preferredStart")}</Label>
            <Input id="preferred_start" type="datetime-local" {...register("preferred_start")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preferred_end">{t("new.preferredEnd")}</Label>
            <Input id="preferred_end" type="datetime-local" {...register("preferred_end")} />
            <FieldError message={serverErrors.preferred_end} />
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">{t("new.whenHint", { timeZone })}</p>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending} data-testid="create-job">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {t("new.submit")}
        </Button>
      </div>
    </form>
  );
}

function CustomerPicker({ value, onChange }: { value: CustomerOption | null; onChange: (c: CustomerOption | null) => void }) {
  const t = useTranslations("jobs");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const id = setTimeout(async () => {
      const r = await searchCustomersAction(query);
      if (r.ok) setOptions(r.data);
      setLoading(false);
    }, 200);
    return () => clearTimeout(id);
  }, [query, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-labelledby="customer-label" className="w-full justify-between font-normal" data-testid="customer-picker">
          {value ? value.name : <span className="text-muted-foreground">{t("new.searchCustomer")}</span>}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("new.searchCustomer")} value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
                <Loader2 className="size-4 animate-spin" /> {t("loading")}
              </div>
            ) : (
              <CommandEmpty>{t("new.noCustomers")}</CommandEmpty>
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
                  <span className="text-muted-foreground ml-auto text-xs">{c.type === "commercial" ? t("new.commercial") : t("new.residential")}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
