"use client";
import {
  JOB_PRIORITIES,
  LOW_CONFIDENCE,
  type IntakeConfidenceField,
  type JobPriority,
} from "@fieldops/shared";
import { AlertTriangle, Check, ChevronsUpDown, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fromLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createJobAction, customerSitesAction, searchCustomersAction } from "../actions";
import { createJobFromDraftAction, discardDraftAction, type DraftView } from "./ai-actions";
import { AiDraftPanel, type AiIntakeStatus } from "./ai-draft-panel";

type CustomerOption = { id: string; name: string; type?: string; siteCount?: number };
type SiteOption = {
  id: string;
  label: string;
  line1: string;
  city: string;
  equipment: { id: string; label: string }[];
};

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

/** The AI's description for the technician: its summary plus the details it read from the message. */
function draftDescription(d: NonNullable<DraftView["draft"]>): string {
  const equipment = [d.equipment.type, d.equipment.brand, d.equipment.model].filter(Boolean).join(" · ");
  const contact = [d.contact.name, d.contact.phone, d.contact.email].filter(Boolean).join(" · ");
  return [
    d.summary,
    equipment ? `Equipment: ${equipment}` : null,
    contact ? `Contact: ${contact}` : null,
    d.contact.address ? `Address: ${d.contact.address}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Marks a field the AI filled in; low-confidence fields ask the dispatcher to check them (AI-01). */
function AiTag({ id, state }: { id: string; state: "ok" | "low" | null }) {
  const t = useTranslations("ai.intake");
  if (!state) return null;
  return state === "low" ? (
    <span
      id={id}
      className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle className="size-3" aria-hidden /> {t("lowConfidence")}
    </span>
  ) : (
    <span id={id} className="inline-flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300">
      <Sparkles className="size-3" aria-hidden /> {t("filled")}
    </span>
  );
}

const lowRing = "border-amber-500 ring-2 ring-amber-500/30";

export function NewJobForm({
  timeZone,
  serviceTypes,
  initialCustomer,
  ai,
}: {
  timeZone: string;
  serviceTypes: { id: string; name: string; duration: number }[];
  initialCustomer: CustomerOption | null;
  /** AI drafting for office roles (AI-01); null hides the panel. */
  ai?: AiIntakeStatus | null;
}) {
  const t = useTranslations("jobs");
  const tai = useTranslations("ai.intake");
  const tp = useTranslations("common.priority");
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerOption | null>(initialCustomer);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [aiDraft, setAiDraft] = useState<DraftView | null>(null);
  const [keptChecklist, setKeptChecklist] = useState<string[]>([]);
  const defaults: FormValues = {
    priority: "normal",
    title: "",
    description: "",
    service_type_id: "",
    equipment_id: "",
    preferred_start: "",
    preferred_end: "",
    estimated_duration_min: "",
  };
  const { register, handleSubmit, setValue, watch, reset } = useForm<FormValues>({ defaultValues: defaults });
  const draft = aiDraft?.draft ?? null;
  const aiState = (field: IntakeConfidenceField): "ok" | "low" | null =>
    draft ? (draft.confidence[field] < LOW_CONFIDENCE ? "low" : "ok") : null;
  const aiIds = {
    title: "ai-title",
    service_type: "ai-service-type",
    priority: "ai-priority",
    summary: "ai-summary",
    estimated_duration: "ai-duration",
    contact: "ai-customer",
  } as const;
  const describedBy = (field: keyof typeof aiIds) => (aiState(field) ? aiIds[field] : undefined);

  const applyDraft = (d: DraftView) => {
    if (!d.draft) return;
    setAiDraft(d);
    setKeptChecklist(d.draft.checklist);
    setValue("title", d.draft.title);
    setValue("description", draftDescription(d.draft));
    setValue("priority", d.draft.priority);
    setValue("service_type_id", d.draft.service_type_id ?? "");
    setValue(
      "estimated_duration_min",
      d.draft.estimated_duration_min ? String(d.draft.estimated_duration_min) : "",
    );
    // A customer matched on email or phone is preselected; a match on the name only is offered below the picker.
    const strong = d.suggestions.find((s) => s.matched_on !== "name");
    if (strong && !customer) setCustomer({ id: strong.id, name: strong.name });
  };

  const clearDraft = () => {
    if (aiDraft) void discardDraftAction(aiDraft.interactionId);
    setAiDraft(null);
    setKeptChecklist([]);
    reset(defaults);
    setCustomer(initialCustomer);
  };

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
      const job = {
        customer_id: customer!.id,
        site_id: siteId,
        equipment_id: v.equipment_id || null,
        service_type_id: v.service_type_id || null,
        title: v.title,
        description: v.description,
        priority: v.priority,
        source: "manual" as const,
        preferred_start: fromLocalInput(v.preferred_start, timeZone),
        preferred_end: fromLocalInput(v.preferred_end, timeZone),
        estimated_duration_min: v.estimated_duration_min ? Number(v.estimated_duration_min) : null,
      };
      // A job saved from an AI draft records what the dispatcher kept (accepted or edited, §9.1).
      const result = aiDraft
        ? await createJobFromDraftAction({
            interaction_id: aiDraft.interactionId,
            checklist: keptChecklist,
            job,
          })
        : await createJobAction(job);
      if (!result.ok) {
        setServerErrors(Object.fromEntries((result.error.fields ?? []).map((f) => [f.path, f.message])));
        toast.error(result.error.message);
        return;
      }
      toast.success(t("new.created", { number: result.data.number }));
      router.push(`/jobs/${result.data.number}`);
    });
  });

  const nameMatches =
    aiDraft?.suggestions.filter((s) => s.matched_on === "name" && s.id !== customer?.id) ?? [];

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {ai ? (
        <AiDraftPanel
          status={ai}
          draft={aiDraft}
          keptChecklist={keptChecklist}
          onKeptChecklist={setKeptChecklist}
          onDraft={applyDraft}
          onClear={clearDraft}
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("new.where")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label id="customer-label">{t("new.customer")}</Label>
              {customer && aiDraft?.suggestions.some((s) => s.id === customer.id) ? (
                <AiTag id={aiIds.contact} state={aiState("contact")} />
              ) : null}
            </div>
            <CustomerPicker value={customer} onChange={setCustomer} />
            {nameMatches.length ? (
              <div
                className="flex flex-wrap items-center gap-2 text-sm"
                data-testid="ai-customer-suggestions"
              >
                <span className="text-muted-foreground">{tai("suggestedCustomers")}</span>
                {nameMatches.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCustomer({ id: s.id, name: s.name })}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>
            ) : null}
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
            <Select
              value={watch("equipment_id") || "none"}
              onValueChange={(v) => setValue("equipment_id", v === "none" ? "" : v)}
              disabled={!site?.equipment.length}
            >
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="service_type">{t("col.serviceType")}</Label>
              <AiTag id={aiIds.service_type} state={aiState("service_type")} />
            </div>
            <Select
              value={watch("service_type_id") || "none"}
              onValueChange={(v) => {
                const id = v === "none" ? "" : v;
                setValue("service_type_id", id);
                const st = serviceTypes.find((s) => s.id === id);
                if (st && !watch("estimated_duration_min"))
                  setValue("estimated_duration_min", String(st.duration));
                if (st && !watch("title")) setValue("title", st.name);
              }}
            >
              <SelectTrigger
                id="service_type"
                className={cn("w-full", aiState("service_type") === "low" && lowRing)}
                aria-describedby={describedBy("service_type")}
              >
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="estimated_duration_min">{t("new.duration")}</Label>
              <AiTag id={aiIds.estimated_duration} state={aiState("estimated_duration")} />
            </div>
            <Input
              id="estimated_duration_min"
              className={cn(aiState("estimated_duration") === "low" && lowRing)}
              aria-describedby={describedBy("estimated_duration")}
              type="number"
              min={5}
              max={1440}
              step={5}
              inputMode="numeric"
              {...register("estimated_duration_min")}
            />
            <FieldError message={serverErrors.estimated_duration_min} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="title">{t("new.jobTitle")}</Label>
              <AiTag id={aiIds.title} state={aiState("title")} />
            </div>
            <Input
              id="title"
              className={cn(aiState("title") === "low" && lowRing)}
              aria-describedby={describedBy("title")}
              maxLength={200}
              aria-invalid={Boolean(serverErrors.title)}
              {...register("title")}
            />
            <FieldError message={serverErrors.title} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="description">{t("new.descriptionLabel")}</Label>
              <AiTag id={aiIds.summary} state={aiState("summary")} />
            </div>
            <Textarea
              id="description"
              className={cn(aiState("summary") === "low" && lowRing)}
              aria-describedby={describedBy("summary")}
              rows={4}
              maxLength={8000}
              placeholder={t("new.descriptionPlaceholder")}
              {...register("description")}
            />
          </div>
          <fieldset className="space-y-2 sm:col-span-2" aria-describedby={describedBy("priority")}>
            <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
              {t("col.priority")}
              <AiTag id={aiIds.priority} state={aiState("priority")} />
            </legend>
            <RadioGroup
              value={watch("priority")}
              onValueChange={(v) => setValue("priority", v as JobPriority)}
              className="flex flex-wrap gap-2"
            >
              {JOB_PRIORITIES.map((p) => (
                <label
                  key={p}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                    watch("priority") === p && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem value={p} />
                  {tp(p)}
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

function CustomerPicker({
  value,
  onChange,
}: {
  value: CustomerOption | null;
  onChange: (c: CustomerOption | null) => void;
}) {
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
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-labelledby="customer-label"
          className="w-full justify-between font-normal"
          data-testid="customer-picker"
        >
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
                  <span className="text-muted-foreground ml-auto text-xs">
                    {c.type === "commercial" ? t("new.commercial") : t("new.residential")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
