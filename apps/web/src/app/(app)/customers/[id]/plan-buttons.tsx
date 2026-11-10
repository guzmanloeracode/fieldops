"use client";
import { Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
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
import { deletePlanAction, setPlanActiveAction } from "./plan-actions";

/** Pause or resume a maintenance plan, and delete it after a confirmation. */
export function PlanButtons({
  customerId,
  plan,
}: {
  customerId: string;
  plan: { id: string; title: string; active: boolean; ended: boolean };
}) {
  const t = useTranslations("recurrences.plans");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error?.message ?? "");
        return;
      }
      toast.success(done);
      router.refresh();
    });

  return (
    <>
      {plan.ended ? null : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          data-testid={`plan-${plan.active ? "pause" : "resume"}`}
          aria-label={`${plan.active ? t("pause") : t("resume")}: ${plan.title}`}
          onClick={() =>
            run(
              () => setPlanActiveAction(customerId, plan.id, !plan.active),
              plan.active ? t("paused") : t("resumed"),
            )
          }
        >
          {plan.active ? <Pause /> : <Play />}
          <span className="hidden sm:inline">{plan.active ? t("pause") : t("resume")}</span>
        </Button>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            aria-label={`${t("delete")}: ${plan.title}`}
          >
            <Trash2 />
            <span className="hidden sm:inline">{t("delete")}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle", { title: plan.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={(e) => {
                e.preventDefault();
                run(() => deletePlanAction(customerId, plan.id), t("deleted"));
              }}
            >
              {t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
