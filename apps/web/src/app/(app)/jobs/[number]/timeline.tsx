import { formatMoney, STATUS_LABELS } from "@fieldops/core";
import type { Currency, JobEventType, JobStatus } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatWindow } from "@/lib/format";
import { formatDay, formatPause } from "@/lib/recurrence";

type Event = {
  id: string;
  type: JobEventType;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  actor: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

/** Every change to the job with who did it and when (JOB-02). */
export async function Timeline({
  events,
  timeZone,
  members,
}: {
  events: Event[];
  timeZone: string;
  members: Record<string, string>;
}) {
  const t = await getTranslations("jobs");
  const te = await getTranslations("expenses.timeline");
  const amount = (p: Record<string, unknown>) =>
    formatMoney({ amountMinor: Number(p.total_minor ?? 0), currency: (p.currency as Currency) ?? "USD" });
  const tf = await getTranslations("fieldwork.timeline");
  const tp = await getTranslations("portal.timeline");
  // Portal requests (POR-02) name the customer's contact and the times that suit them.
  const portalContact = (e: Event) =>
    !e.actor && typeof e.payload.contact_name === "string" ? e.payload.contact_name : null;
  const portalWindows = (e: Event) =>
    Array.isArray(e.payload.preferred_windows)
      ? (e.payload.preferred_windows as { start?: unknown; end?: unknown }[])
          .filter((w) => typeof w.start === "string" && typeof w.end === "string")
          .map((w) => formatWindow(String(w.start), String(w.end), timeZone))
      : [];
  const ta = await getTranslations("ai.timeline");
  // Maintenance plans (JOB-13) and the SLA pause (SLA-04).
  const tr = await getTranslations("recurrences");
  const trReport = await getTranslations("reports.timeline");
  const describe = (e: Event): string => {
    switch (e.type) {
      case "created":
        if (portalContact(e)) return tp("requested");
        if (e.payload.source === "recurring" && typeof e.payload.occurrence_date === "string") {
          return tr("timeline.created", {
            title: String(e.payload.plan_title ?? ""),
            date: formatDay(e.payload.occurrence_date, "long"),
          });
        }
        return t("timeline.created", { source: t(`source.${String(e.payload.source ?? "manual")}`) });
      case "status_changed":
        return t("timeline.status", {
          from: e.fromStatus ? STATUS_LABELS[e.fromStatus] : "—",
          to: e.toStatus ? STATUS_LABELS[e.toStatus] : "—",
        });
      case "assigned": {
        const names = ((e.payload.member_ids as string[] | undefined) ?? [])
          .map((id) => members[id] ?? "?")
          .join(", ");
        const window = e.payload.scheduled_start
          ? formatWindow(String(e.payload.scheduled_start), String(e.payload.scheduled_end), timeZone)
          : null;
        return names
          ? window
            ? t("timeline.assignedAt", { names, window })
            : t("timeline.assigned", { names })
          : t("timeline.unassigned");
      }
      case "note_added":
        return e.payload.visibility === "customer" ? t("timeline.noteCustomer") : t("timeline.note");
      case "attachment_added":
        return t("timeline.attachment", { name: String(e.payload.file_name ?? "") });
      case "expense_requested":
        return te(e.payload.auto_approved ? "requestedAuto" : "requested", {
          item: String(e.payload.item ?? ""),
          amount: amount(e.payload),
        });
      case "expense_decided":
        return te(e.payload.decision === "rejected" ? "rejected" : "approved", {
          item: String(e.payload.item ?? ""),
          amount: amount(e.payload),
        });
      case "part_used":
        return te("used", { item: String(e.payload.item ?? "") });
      case "updated":
        return t("timeline.updated", {
          fields: ((e.payload.fields as string[] | undefined) ?? []).join(", "),
        });
      case "checklist_updated": {
        const items = (e.payload.items as string[] | undefined) ?? [];
        return Number(e.payload.cleared ?? 0) > 0 && Number(e.payload.done ?? 0) === 0
          ? tf("checklistCleared", { items: items.join(", ") })
          : tf("checklist", { items: items.join(", ") });
      }
      case "time_edited":
        return tf(e.payload.action === "added" ? "timeAdded" : "timeEdited", {
          kind: tf(`kind.${e.payload.kind === "travel" ? "travel" : "work"}`),
          name: String(e.payload.member_name ?? "?"),
        });
      case "signature_captured":
        return tf("signature", { name: String(e.payload.signer_name ?? "") });
      case "reviewed": {
        const applied = (e.payload.applied as string[] | undefined) ?? [];
        const fields = applied.map((f) => ta(`fields.${f}`)).join(", ");
        if (!e.payload.confirmed) return ta("applied", { fields });
        return applied.length ? ta("confirmedApplied", { fields }) : ta("confirmed");
      }
      case "report_sent":
        return trReport("sent", { to: String(e.payload.to ?? "") });
      default:
        return e.type;
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("timeline.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 border-l pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden
                className="bg-background ring-border absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-2"
              />
              <p className="text-sm">
                <span className="font-medium">
                  {e.actor ??
                    (portalContact(e) ? tp("customer", { name: portalContact(e)! }) : t("timeline.system"))}
                </span>{" "}
                {describe(e)}
              </p>
              {e.type === "created" && portalWindows(e).length ? (
                <p className="text-muted-foreground text-sm">
                  {tp("windows", { windows: portalWindows(e).join("; ") })}
                </p>
              ) : null}
              {typeof e.payload.reason === "string" ? (
                <p className="text-muted-foreground text-sm">“{e.payload.reason}”</p>
              ) : null}
              {e.type === "expense_decided" && typeof e.payload.comment === "string" ? (
                <p className="text-muted-foreground text-sm">“{e.payload.comment}”</p>
              ) : null}
              {e.payload.sla_paused === true ? (
                <p className="text-muted-foreground text-sm">{tr("slaPause.timelinePaused")}</p>
              ) : null}
              {typeof e.payload.sla_paused_minutes === "number" ? (
                <p className="text-muted-foreground text-sm" data-testid="timeline-sla-resumed">
                  {tr("slaPause.timelineResumed", {
                    duration: formatPause(tr, e.payload.sla_paused_minutes),
                    due:
                      typeof e.payload.resolution_due_at === "string"
                        ? formatDateTime(e.payload.resolution_due_at, timeZone)
                        : "—",
                  })}
                </p>
              ) : null}
              {typeof e.payload.override_reason === "string" ? (
                <p className="text-muted-foreground text-sm">
                  {t("timeline.override", { reason: e.payload.override_reason })}
                </p>
              ) : null}
              <time className="text-muted-foreground text-xs" dateTime={e.createdAt}>
                {formatDateTime(e.createdAt, timeZone)}
              </time>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
