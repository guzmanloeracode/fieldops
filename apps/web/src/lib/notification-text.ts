import { formatJobNumber } from "@fieldops/core";
import type { NotificationEvent, NotificationPayload } from "@fieldops/shared";
import { formatDateTime } from "./format";

/** The `notifications` namespace translator (server or client). */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The text of a notification, built from its type and payload (NOT-01). Facts that may be missing fall back to
 * neutral words, so older payloads still read well.
 */
export function describeNotification(
  t: Translate,
  n: { type: NotificationEvent; payload: NotificationPayload },
  timeZone: string,
): { title: string; detail: string | null } {
  const p = n.payload;
  const job = p.job_number !== undefined ? formatJobNumber(p.job_number) : t("fallback.job");
  const title = t(`events.${n.type}`, {
    job,
    actor: p.actor_name ?? t("fallback.actor"),
    item: p.item ?? t("fallback.item"),
    decision: p.decision ?? "approved",
  });
  const about = [p.job_title, p.customer_name].filter(Boolean).join(" · ");
  let when: string | null = null;
  if ((n.type === "job_assigned" || n.type === "job_rescheduled") && p.scheduled_start) {
    when = t("detail.starts", { when: formatDateTime(p.scheduled_start, timeZone) });
  }
  if ((n.type === "sla_at_risk" || n.type === "sla_breached") && p.due_at) {
    when = t("detail.due", { target: p.target ?? "resolution", when: formatDateTime(p.due_at, timeZone) });
  }
  const detail = [about, when].filter(Boolean).join(" — ");
  return { title, detail: detail || null };
}
