import type { SlaState } from "@fieldops/shared";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// SLA state badges (SLA-02). Shared by server and client components; relative times are worked out by the
// caller on the server, so the client never renders a different "due in" than the server did.

const STYLES: Record<SlaState, string> = {
  on_track: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  at_risk:
    "bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  breached: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
  met: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
};
const ICONS = { on_track: Clock, at_risk: AlertTriangle, breached: XCircle, met: CheckCircle2 } as const;

/**
 * A pill with the state. `prefixed` reads "SLA at risk" for places where nothing else says it's about the SLA
 * (lists, cards); the job page's SLA card uses the plain state.
 */
export function SlaBadge({
  state,
  prefixed = false,
  title,
  className,
}: {
  state: SlaState;
  prefixed?: boolean;
  title?: string;
  className?: string;
}) {
  const t = useTranslations("sla");
  const Icon = ICONS[state];
  return (
    <span
      title={title}
      data-sla={state}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        STYLES[state],
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {prefixed ? t(`short.${state}`) : t(`state.${state}`)}
    </span>
  );
}
