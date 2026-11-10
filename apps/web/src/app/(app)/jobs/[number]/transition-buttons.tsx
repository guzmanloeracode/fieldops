"use client";
import type { JobStatus } from "@fieldops/shared";
import { HOLD_REASONS, type HoldReason } from "@fieldops/shared";
import { CheckCircle2, Loader2, Pause, Play, RotateCcw, Truck, Undo2, XCircle, CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { transitionJobAction } from "../actions";

type Action = { to: JobStatus; name: string; requiresReason: boolean };

const ICONS: Record<string, typeof Play> = {
  schedule: CalendarClock,
  unschedule: Undo2,
  cancel: XCircle,
  depart: Truck,
  start: Play,
  hold: Pause,
  resume: Play,
  reschedule: CalendarClock,
  complete: CheckCircle2,
  reopen: RotateCcw,
};
const PRIMARY = new Set(["depart", "start", "resume", "complete"]);

/** Status actions allowed for this user (from core `availableTransitions`), with large touch targets (TEC-02). */
export function TransitionButtons({ jobId, version, actions }: { jobId: string; version: number; actions: Action[] }) {
  const t = useTranslations("jobs");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [holdReason, setHoldReason] = useState<HoldReason>("parts");
  const [error, setError] = useState<string | null>(null);
  // "schedule" and "reschedule" happen through the schedule card, where a time and technician are chosen.
  const visible = actions.filter((a) => a.name !== "schedule" && a.name !== "reschedule");

  const run = (a: Action, input: { reason?: string; hold_reason?: HoldReason }) =>
    startTransition(async () => {
      const result = await transitionJobAction(jobId, { to: a.to, reason: input.reason ?? null, hold_reason: input.hold_reason ?? null }, version);
      if (!result.ok) {
        const missing = (result.error.details?.missing as string[] | undefined) ?? [];
        const message = missing.length ? `${result.error.message}: ${missing.join(", ")}` : result.error.message;
        setError(message);
        toast.error(message);
        return;
      }
      setDialog(null);
      setReason("");
      setError(null);
      toast.success(t("transition.done", { action: t(`transition.${a.name}`) }));
      router.refresh();
    });

  if (!visible.length) return null;
  return (
    <>
      {visible.map((a) => {
        const Icon = ICONS[a.name] ?? Play;
        return (
          <Button
            key={a.name + a.to}
            size="lg"
            variant={PRIMARY.has(a.name) ? "default" : a.name === "cancel" ? "ghost" : "outline"}
            disabled={pending}
            data-testid={`transition-${a.name}`}
            onClick={() => (a.requiresReason || a.name === "hold" ? setDialog(a) : run(a, {}))}
          >
            {pending && !dialog ? <Loader2 className="animate-spin" /> : <Icon />}
            {t(`transition.${a.name}`)}
          </Button>
        );
      })}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog ? t(`transition.${dialog.name}`) : ""}</DialogTitle>
            <DialogDescription>{dialog?.name === "hold" ? t("transition.holdHint") : t("transition.reasonHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog) run(dialog, { reason, ...(dialog.name === "hold" ? { hold_reason: holdReason } : {}) });
            }}
          >
            {dialog?.name === "hold" ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("transition.waitingFor")}</legend>
                <RadioGroup value={holdReason} onValueChange={(v) => setHoldReason(v as HoldReason)} className="grid grid-cols-2 gap-2">
                  {HOLD_REASONS.map((r) => (
                    <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <RadioGroupItem value={r} /> {t(`holdReason.${r}`)}
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="reason">{t("transition.reason")}</Label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required={dialog?.requiresReason} rows={3} maxLength={1000} />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending || (dialog?.requiresReason && !reason.trim())}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {t("confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
