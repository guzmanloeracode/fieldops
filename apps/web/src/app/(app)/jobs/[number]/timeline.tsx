import { formatMoney, STATUS_LABELS } from "@fieldops/core";
import type { Currency, JobEventType, JobStatus } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatWindow } from "@/lib/format";

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
  const describe = (e: Event): string => {
    switch (e.type) {
      case "created":
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
                <span className="font-medium">{e.actor ?? t("timeline.system")}</span> {describe(e)}
              </p>
              {typeof e.payload.reason === "string" ? (
                <p className="text-muted-foreground text-sm">“{e.payload.reason}”</p>
              ) : null}
              {e.type === "expense_decided" && typeof e.payload.comment === "string" ? (
                <p className="text-muted-foreground text-sm">“{e.payload.comment}”</p>
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
