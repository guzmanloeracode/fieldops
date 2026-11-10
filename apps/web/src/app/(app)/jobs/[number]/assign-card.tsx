"use client";
import type { JobStatus } from "@fieldops/shared";
import { AlertTriangle, CalendarClock, Loader2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatWindow, fromLocalInput, toLocalInput } from "@/lib/format";
import { assignJobAction } from "../actions";

type Member = { id: string; name: string; role: string };
type Assignee = { memberId: string; name: string; isLead: boolean };

/** Technicians and the visit window. Saving both on a new job schedules it; overlaps need a reason (SCH-03). */
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(props.assignees.map((a) => a.memberId));
  const [lead, setLead] = useState<string>(
    props.assignees.find((a) => a.isLead)?.memberId ?? props.assignees[0]?.memberId ?? "",
  );
  const [start, setStart] = useState(toLocalInput(props.scheduledStart, props.timeZone));
  const [end, setEnd] = useState(toLocalInput(props.scheduledEnd, props.timeZone));
  const [conflict, setConflict] = useState<string | null>(null);
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
      if (!next.includes(lead)) setLead(next[0] ?? "");
      return next;
    });
  };

  const onStartChange = (v: string) => {
    setStart(v);
    if (v && !end && props.estimatedDurationMin) {
      const d = new Date(`${v}:00`);
      d.setMinutes(d.getMinutes() + props.estimatedDurationMin);
      const pad = (n: number) => String(n).padStart(2, "0");
      setEnd(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      );
    }
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await assignJobAction(props.jobId, {
        member_ids: selected,
        lead_member_id: lead || null,
        scheduled_start: fromLocalInput(start, props.timeZone),
        scheduled_end: fromLocalInput(end, props.timeZone),
        override_reason: conflict ? override || null : null,
      });
      if (!result.ok) {
        if (result.error.code === "conflict" && result.error.details?.conflicts) {
          const conflicts = result.error.details.conflicts as { memberId: string; jobs: number[] }[];
          setConflict(
            conflicts
              .map(
                (c) =>
                  `${props.members.find((m) => m.id === c.memberId)?.name ?? "?"}: ${c.jobs.map((n) => `JOB-${String(n).padStart(6, "0")}`).join(", ")}`,
              )
              .join("; "),
          );
          return;
        }
        setError(result.error.fields?.[0]?.message ?? result.error.message);
        return;
      }
      toast.success(result.data.status === "scheduled" ? t("assign.scheduled") : t("assign.saved"));
      setOpen(false);
      setConflict(null);
      setOverride("");
      router.refresh();
    });

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
              <div className="space-y-4">
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">{t("assign.technicians")}</legend>
                  <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2">
                    {props.members.map((m) => (
                      <label
                        key={m.id}
                        className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                      >
                        <Checkbox checked={selected.includes(m.id)} onCheckedChange={() => toggle(m.id)} />
                        <span>{m.name}</span>
                        <span className="text-muted-foreground ml-auto text-xs capitalize">{m.role}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {selected.length > 1 ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">{t("assign.lead")}</legend>
                    <RadioGroup value={lead} onValueChange={setLead} className="flex flex-wrap gap-2">
                      {selected.map((id) => (
                        <label
                          key={id}
                          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                        >
                          <RadioGroupItem value={id} /> {props.members.find((m) => m.id === id)?.name}
                        </label>
                      ))}
                    </RadioGroup>
                  </fieldset>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sched-start">{t("assign.start")}</Label>
                    <Input
                      id="sched-start"
                      type="datetime-local"
                      value={start}
                      onChange={(e) => onStartChange(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sched-end">{t("assign.end")}</Label>
                    <Input
                      id="sched-end"
                      type="datetime-local"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </div>
                </div>
                {conflict ? (
                  <div
                    className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                    role="alert"
                  >
                    <p className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="size-4" /> {t("assign.conflict")}
                    </p>
                    <p>{conflict}</p>
                    <Label htmlFor="override">{t("assign.overrideReason")}</Label>
                    <Textarea
                      id="override"
                      rows={2}
                      value={override}
                      onChange={(e) => setOverride(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                ) : null}
                {error ? (
                  <p role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  onClick={save}
                  disabled={pending || (Boolean(conflict) && !override.trim())}
                  data-testid="assign-save"
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  {conflict ? t("assign.saveAnyway") : t("assign.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex gap-2">
          <CalendarClock className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formatWindow(props.scheduledStart, props.scheduledEnd, props.timeZone)}</span>
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
