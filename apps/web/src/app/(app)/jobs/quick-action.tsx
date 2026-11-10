"use client";
import type { JobStatus } from "@fieldops/shared";
import { Loader2, Play, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { transitionJobAction } from "./actions";

/** One-tap En route / Start / Resume on the next visit in My day (TEC-02). */
export function QuickAction({
  jobId,
  version,
  to,
  name,
}: {
  jobId: string;
  version: number;
  to: JobStatus;
  name: "depart" | "start" | "resume";
}) {
  const t = useTranslations("jobs");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Icon = name === "depart" ? Truck : Play;
  return (
    <Button
      size="lg"
      className="h-12 flex-1 text-base sm:flex-none"
      disabled={pending}
      data-testid={`quick-${name}`}
      onClick={() =>
        startTransition(async () => {
          const r = await transitionJobAction(jobId, { to, reason: null, hold_reason: null }, version);
          if (!r.ok) {
            toast.error(r.error.message);
            return;
          }
          toast.success(t("transition.done", { action: t(`transition.${name}`) }));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Icon />}
      {t(`transition.${name}`)}
    </Button>
  );
}
