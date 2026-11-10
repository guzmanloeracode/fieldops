"use client";
import type { JobStatus } from "@fieldops/shared";
import { CalendarClock, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AssignForm } from "@/components/app/assign-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatWindow } from "@/lib/format";
import { assignJobAction } from "../actions";

type Member = { id: string; name: string; role: string };
type Assignee = { memberId: string; name: string; isLead: boolean };

/**
 * Technicians (one lead and helpers, JOB-09) and the visit window. Saving both on a new job schedules it;
 * overlaps, working hours, time off and missing skills need a reason (SCH-03).
 */
export function AssignCard(props: {
  jobId: string;
  status: JobStatus;
  canAssign: boolean;
  timeZone: string;
  assignees: Assignee[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  estimatedDurationMin: number | null;
  members: Member[];
}) {
  const t = useTranslations("jobs");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("assign.title")}</CardTitle>
        {props.canAssign ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="assign-open">
                <CalendarClock />{" "}
                {props.assignees.length || props.scheduledStart ? t("assign.change") : t("assign.schedule")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("assign.dialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("assign.dialogDescription", { timeZone: props.timeZone })}
                </DialogDescription>
              </DialogHeader>
              {open ? (
                <AssignForm
                  idPrefix="sched"
                  timeZone={props.timeZone}
                  members={props.members}
                  memberIds={props.assignees.map((a) => a.memberId)}
                  leadId={props.assignees.find((a) => a.isLead)?.memberId ?? null}
                  start={props.scheduledStart}
                  end={props.scheduledEnd}
                  estimatedDurationMin={props.estimatedDurationMin}
                  onSubmit={(input) => assignJobAction(props.jobId, input)}
                  onSaved={(data) => {
                    toast.success(data.status === "scheduled" ? t("assign.scheduled") : t("assign.saved"));
                    setOpen(false);
                    router.refresh();
                  }}
                  onCancel={() => setOpen(false)}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex gap-2">
          <CalendarClock className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {props.scheduledStart
              ? formatWindow(props.scheduledStart, props.scheduledEnd, props.timeZone, locale)
              : t("unscheduled")}
          </span>
        </div>
        <div className="flex gap-2">
          <UserRound className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          {props.assignees.length ? (
            <ul className="space-y-0.5">
              {props.assignees.map((a) => (
                <li key={a.memberId}>
                  {a.name}
                  {a.isLead && props.assignees.length > 1 ? (
                    <span className="text-muted-foreground text-xs"> · {t("assign.leadShort")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">{t("assign.nobody")}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
