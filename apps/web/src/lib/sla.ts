import { currentSla, needsAttention, type SlaFacts } from "@fieldops/core";
import type { SlaTarget } from "@fieldops/shared";

/** The job's current SLA when it needs attention (at risk or breached), for list badges; null otherwise. */
export function attentionSla(
  job: SlaFacts,
): { state: "at_risk" | "breached"; target: SlaTarget; dueAt: Date | null } | null {
  const c = currentSla(job);
  return c && needsAttention(c.state) ? { state: c.state, target: c.target, dueAt: c.dueAt } : null;
}
