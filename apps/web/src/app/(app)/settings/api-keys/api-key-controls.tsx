"use client";
import { API_KEY_EXPIRY_DAYS, type ApiKeyScope } from "@fieldops/shared";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

function useCopy() {
  const t = useTranslations("apiKeys.created");
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };
  return { copied, copy };
}

/** Preformatted text with a copy button: commands and configuration on the page. */
export function CodeBlock({ code, label, testId }: { code: string; label: string; testId?: string }) {
  const t = useTranslations("apiKeys.created");
  const { copied, copy } = useCopy();
  return (
    <div className="relative">
      <pre
        data-testid={testId}
        tabIndex={0}
        aria-label={label}
        className="bg-muted overflow-x-auto rounded-md p-3 pr-12 font-mono text-xs leading-relaxed"
      >
        {code}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1.5 right-1.5"
        aria-label={`${t("copy")}: ${label}`}
        onClick={() => copy(code)}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

type Created = { id: string; name: string; key: string };

/** "New API key": name, scope and expiry; then the key, shown this one time with a copy button. */
export function CreateApiKeyDialog({ baseUrl }: { baseUrl: string }) {
  const t = useTranslations("apiKeys");
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("read");
  const [expiry, setExpiry] = useState("90");
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<Created | null>(null);
  const { copied, copy } = useCopy();

  const reset = () => {
    setName("");
    setScope("read");
    setExpiry("90");
    setError(undefined);
    setCreated(null);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      if (created) router.refresh();
      reset();
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("create.nameRequired"));
      return;
    }
    startTransition(async () => {
      const res = await createApiKeyAction({
        name,
        scopes: [scope],
        expires_in_days: expiry === "never" ? null : Number(expiry),
      });
      if (!res.ok) {
        const field = res.error.fields?.find((f) => f.path === "name");
        setError(field?.message);
        toast.error(res.error.message);
        return;
      }
      setCreated(res.data);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("created.title")}</DialogTitle>
              <DialogDescription>{t("created.description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={`${ids}-key`}>{t("created.keyLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id={`${ids}-key`}
                  readOnly
                  value={created.key}
                  data-testid="new-api-key"
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={() => copy(created.key)}>
                  {copied ? <Check /> : <Copy />} {t("created.copy")}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("created.tryIt")}</p>
              <CodeBlock
                label={t("created.tryIt")}
                code={`curl ${baseUrl}/api/v1/jobs?limit=5 \\\n  -H "Authorization: Bearer ${created.key}"`}
              />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t("created.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("create.title")}</DialogTitle>
              <DialogDescription>{t("create.description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-name`}>{t("create.name")}</Label>
              <Input
                id={`${ids}-name`}
                value={name}
                maxLength={80}
                placeholder={t("create.namePlaceholder")}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${ids}-name-hint${error ? ` ${ids}-name-error` : ""}`}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(undefined);
                }}
              />
              <p id={`${ids}-name-hint`} className="text-muted-foreground text-xs">
                {t("create.nameHint")}
              </p>
              <FieldError id={`${ids}-name-error`} message={error} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("create.scope")}</legend>
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as ApiKeyScope)}>
                {(["read", "write"] as const).map((s) => (
                  <div key={s} className="flex items-start gap-2">
                    <RadioGroupItem
                      value={s}
                      id={`${ids}-scope-${s}`}
                      aria-describedby={`${ids}-scope-${s}-hint`}
                      className="mt-0.5"
                    />
                    <div>
                      <Label htmlFor={`${ids}-scope-${s}`}>
                        {t(s === "read" ? "create.scopeRead" : "create.scopeWrite")}
                      </Label>
                      <p id={`${ids}-scope-${s}-hint`} className="text-muted-foreground text-xs">
                        {t(s === "read" ? "create.scopeReadHint" : "create.scopeWriteHint")}
                      </p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-expiry`}>{t("create.expiry")}</Label>
              <NativeSelect id={`${ids}-expiry`} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {API_KEY_EXPIRY_DAYS.map((d) => (
                  <option key={d} value={String(d)}>
                    {t("create.days", { count: d })}
                  </option>
                ))}
                <option value="never">{t("create.never")}</option>
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("create.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null} {t("create.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RevokeApiKeyButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("apiKeys.revoke");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" aria-label={t("label", { name })} onClick={() => setOpen(true)}>
        {t("button")}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 text-white"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await revokeApiKeyAction(id);
                if (!res.ok) {
                  toast.error(res.error.message);
                  return;
                }
                toast.success(t("done"));
                setOpen(false);
                router.refresh();
              });
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : null} {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
