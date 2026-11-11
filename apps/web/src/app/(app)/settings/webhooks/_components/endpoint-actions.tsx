"use client";
import type { WebhookEndpointRepr } from "@fieldops/shared";
import { KeyRound, Power, PowerOff, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteEndpointAction, rotateSecretAction, sendTestAction, updateEndpointAction } from "../actions";
import { EndpointDialog } from "./endpoint-dialog";
import { SecretDialog } from "./secret-dialog";

/** The endpoint page's actions: test, edit, turn off or on, rotate the secret, delete. */
export function EndpointActions({ endpoint, note }: { endpoint: WebhookEndpointRepr; note?: string }) {
  const t = useTranslations("webhooks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error?.message ?? "");
        return;
      }
      toast.success(success);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("detail.actions")}>
      <Button
        size="sm"
        disabled={pending || !endpoint.enabled}
        onClick={() => run(() => sendTestAction(endpoint.id), t("detail.testSent"))}
      >
        <Send /> {t("detail.sendTest")}
      </Button>
      <EndpointDialog endpoint={endpoint} note={note} />
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () => updateEndpointAction(endpoint.id, { enabled: !endpoint.enabled }),
            endpoint.enabled ? t("detail.turnedOff") : t("detail.turnedOn"),
          )
        }
      >
        {endpoint.enabled ? <PowerOff /> : <Power />}
        {endpoint.enabled ? t("detail.turnOff") : t("detail.turnOn")}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>
            <KeyRound /> {t("detail.rotate")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.rotateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.rotateBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("form.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(async () => {
                  const res = await rotateSecretAction(endpoint.id);
                  if (!res.ok) {
                    toast.error(res.error.message);
                    return;
                  }
                  setSecret(res.data.secret);
                })
              }
            >
              {t("detail.rotate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={pending}
          >
            <Trash2 /> {t("detail.delete")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("form.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const res = await deleteEndpointAction(endpoint.id);
                  if (!res.ok) {
                    toast.error(res.error.message);
                    return;
                  }
                  toast.success(t("detail.deleted"));
                  router.push("/settings/webhooks");
                });
              }}
            >
              {t("detail.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SecretDialog
        secret={secret}
        title={t("secret.rotatedTitle")}
        rotated
        onDone={() => {
          setSecret(null);
          router.refresh();
        }}
      />
    </div>
  );
}
