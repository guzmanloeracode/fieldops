"use client";
import { Copy, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Shows a signing secret once, after an endpoint is added or its secret rotated. */
export function SecretDialog({
  secret,
  title,
  rotated,
  onDone,
}: {
  secret: string | null;
  title: string;
  rotated?: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("webhooks.secret");
  const id = useId();
  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };
  return (
    <Dialog open={secret !== null} onOpenChange={(o) => (o ? undefined : onDone())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden /> {title}
          </DialogTitle>
          <DialogDescription>{t("body")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor={id} className="text-sm font-medium">
            {t("title")}
          </label>
          <input
            id={id}
            readOnly
            value={secret ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            className="bg-muted w-full rounded-md border px-3 py-2 font-mono text-xs break-all"
            data-testid="webhook-secret"
          />
        </div>
        {rotated ? (
          <Alert>
            <AlertDescription>{t("rotatedBody")}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copy}>
            <Copy /> {t("copy")}
          </Button>
          <Button type="button" onClick={onDone}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
