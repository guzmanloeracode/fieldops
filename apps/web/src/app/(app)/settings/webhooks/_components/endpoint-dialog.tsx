"use client";
import type { WebhookEndpointRepr, WebhookEndpointWithSecret, WebhookEventType } from "@fieldops/shared";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EVENTS_BY_GROUP } from "@/lib/webhook-samples";
import { createEndpointAction, updateEndpointAction } from "../actions";
import { SecretDialog } from "./secret-dialog";

type Errors = Partial<Record<"url" | "description" | "event_types", string>>;

/** Adds an endpoint (then shows its secret once) or edits one: URL, description and the events it receives. */
export function EndpointDialog({
  endpoint,
  disabled,
  disabledHint,
}: {
  endpoint?: WebhookEndpointRepr;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const t = useTranslations("webhooks");
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [all, setAll] = useState(endpoint ? endpoint.event_types.includes("*") : true);
  const [chosen, setChosen] = useState<Set<WebhookEventType>>(
    new Set(endpoint?.event_types.filter((e): e is WebhookEventType => e !== "*") ?? []),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] = useState<WebhookEndpointWithSecret | null>(null);

  const reset = () => {
    setUrl(endpoint?.url ?? "");
    setDescription(endpoint?.description ?? "");
    setAll(endpoint ? endpoint.event_types.includes("*") : true);
    setChosen(new Set(endpoint?.event_types.filter((e): e is WebhookEventType => e !== "*") ?? []));
    setErrors({});
  };

  const toggle = (type: WebhookEventType, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!all && chosen.size === 0) {
      setErrors({ event_types: t("form.chooseAtLeastOne") });
      return;
    }
    const payload = { url: url.trim(), description, event_types: all ? ["*"] : [...chosen] };
    startTransition(async () => {
      const res = endpoint
        ? await updateEndpointAction(endpoint.id, payload)
        : await createEndpointAction(payload);
      if (!res.ok) {
        const next: Errors = {};
        for (const f of res.error.fields ?? []) {
          const key = f.path.split(".")[0] as keyof Errors;
          if (key === "url" || key === "description" || key === "event_types") next[key] ??= f.message;
        }
        setErrors(next);
        toast.error(res.error.message);
        return;
      }
      setOpen(false);
      if (endpoint) {
        toast.success(t("form.saved"));
      } else {
        setCreated(res.data as WebhookEndpointWithSecret);
        reset();
      }
      router.refresh();
    });
  };

  const urlId = `${ids}-url`;
  const descId = `${ids}-desc`;
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) reset();
        }}
      >
        <DialogTrigger asChild>
          {endpoint ? (
            <Button variant="outline" size="sm">
              <Pencil /> {t("detail.edit")}
            </Button>
          ) : (
            <Button disabled={disabled} title={disabled ? disabledHint : undefined}>
              <Plus /> {t("endpoints.add")}
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={submit} className="space-y-5" noValidate>
            <DialogHeader>
              <DialogTitle>{endpoint ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
              <DialogDescription>{t("form.urlHint")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={urlId}>{t("form.url")}</Label>
              <Input
                id={urlId}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder={t("form.urlPlaceholder")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={Boolean(errors.url)}
                aria-describedby={errors.url ? `${urlId}-error` : undefined}
                required
              />
              <FieldError id={`${urlId}-error`} message={errors.url} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={descId}>{t("form.description")}</Label>
              <Input
                id={descId}
                maxLength={200}
                placeholder={t("form.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-invalid={Boolean(errors.description)}
              />
              <FieldError message={errors.description} />
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("form.events")}</legend>
              <RadioGroup
                value={all ? "all" : "some"}
                onValueChange={(v) => {
                  setAll(v === "all");
                  setErrors((e) => ({ ...e, event_types: undefined }));
                }}
                className="gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id={`${ids}-all`} />
                  <Label htmlFor={`${ids}-all`} className="font-normal">
                    {t("form.allEvents")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="some" id={`${ids}-some`} />
                  <Label htmlFor={`${ids}-some`} className="font-normal">
                    {t("form.chooseEvents")}
                  </Label>
                </div>
              </RadioGroup>
              {all ? null : (
                <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
                  {EVENTS_BY_GROUP.map(({ group, types }) => (
                    <fieldset key={group} className="space-y-2">
                      <legend className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t(`groups.${group}`)}
                      </legend>
                      {types.map((type) => {
                        const id = `${ids}-${type}`;
                        return (
                          <div key={type} className="flex items-start gap-2">
                            <Checkbox
                              id={id}
                              checked={chosen.has(type)}
                              onCheckedChange={(v) => {
                                toggle(type, v === true);
                                setErrors((e) => ({ ...e, event_types: undefined }));
                              }}
                              className="mt-0.5"
                            />
                            <Label htmlFor={id} className="block font-normal">
                              <code className="text-xs">{type}</code>
                              <span className="text-muted-foreground block text-xs">
                                {t(`events.${type}`)}
                              </span>
                            </Label>
                          </div>
                        );
                      })}
                    </fieldset>
                  ))}
                </div>
              )}
              <FieldError message={errors.event_types} />
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {endpoint ? t("form.save") : t("form.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <SecretDialog
        secret={created?.secret ?? null}
        title={t("secret.createdTitle")}
        onDone={() => {
          const id = created?.id;
          setCreated(null);
          if (id) router.push(`/settings/webhooks/${id}`);
        }}
      />
    </>
  );
}
