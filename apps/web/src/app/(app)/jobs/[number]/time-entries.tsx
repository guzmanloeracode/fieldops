"use client";
import type { TimeEntryKind } from "@fieldops/shared";
import { Car, Clock, Loader2, Pencil, Plus, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, fromLocalInput, inZone, toLocalInput } from "@/lib/format";
import { format } from "date-fns";
import { addTimeEntryAction, updateTimeEntryAction } from "./fieldwork-actions";

export type TimeEntryView = {
  id: string;
  memberId: string;
  memberName: string;
  kind: TimeEntryKind;
  startedAt: string;
  endedAt: string | null;
  source: "status" | "manual";
  editedReason: string | null;
};

const minutesOf = (e: Pick<TimeEntryView, "startedAt" | "endedAt">, now: number) =>
  Math.max(0, Math.round(((e.endedAt ? Date.parse(e.endedAt) : now) - Date.parse(e.startedAt)) / 60_000));

/** "1 h 05 min" style durations. */
function useDuration() {
  const t = useTranslations("fieldwork.time");
  return (minutes: number) =>
    minutes >= 60
      ? t("hoursMinutes", { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") })
      : t("minutes", { m: minutes });
}

/** Travel and work time recorded from status changes (TEC-04), editable with a reason. */
export function TimeEntries({
  jobId,
  entries,
  timeZone,
  actorMemberId,
  canEditAll,
  canAddOwn,
  members,
}: {
  jobId: string;
  entries: TimeEntryView[];
  timeZone: string;
  actorMemberId: string;
  /** Office roles: edit anyone's time and add time for any member. */
  canEditAll: boolean;
  /** Assigned technicians: edit and add their own time. */
  canAddOwn: boolean;
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("fieldwork.time");
  const duration = useDuration();
  const [now, setNow] = useState(() => Date.now());
  const running = entries.some((e) => !e.endedAt);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [running]);
  const [editing, setEditing] = useState<TimeEntryView | null>(null);
  const [adding, setAdding] = useState(false);

  const byMember = new Map<string, { name: string; travel: number; work: number; running: TimeEntryKind | null }>();
  for (const e of entries) {
    const m = byMember.get(e.memberId) ?? { name: e.memberName, travel: 0, work: 0, running: null };
    if (e.kind === "travel") m.travel += minutesOf(e, now);
    else m.work += minutesOf(e, now);
    if (!e.endedAt) m.running = e.kind;
    byMember.set(e.memberId, m);
  }
  const mayEdit = (e: TimeEntryView) => canEditAll || (canAddOwn && e.memberId === actorMemberId);
  if (!entries.length && !canEditAll && !canAddOwn) return null;

  return (
    <Card data-testid="time-entries">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        {canEditAll || canAddOwn ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> {t("add")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {[...byMember.entries()].map(([id, m]) => (
                <li key={id} className="bg-muted/50 rounded-lg p-3 text-sm">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-muted-foreground">
                    {t("totals", { travel: duration(m.travel), work: duration(m.work) })}
                  </p>
                  {m.running ? (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-green-800 dark:text-green-400">
                      <span className="size-2 animate-pulse rounded-full bg-current" aria-hidden />
                      {t(m.running === "travel" ? "runningTravel" : "runningWork")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <ul className="divide-y text-sm">
              {entries.map((e) => {
                const Icon = e.kind === "travel" ? Car : Wrench;
                return (
                  <li key={e.id} className="flex items-center gap-3 py-2" data-testid="time-entry">
                    <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-medium">{t(`kind.${e.kind}`)}</span> · {e.memberName}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(e.startedAt, timeZone)} –{" "}
                        {e.endedAt ? format(inZone(e.endedAt, timeZone), "h:mm a") : t("now")} ·{" "}
                        {duration(minutesOf(e, now))}
                        {e.source === "manual" ? ` · ${t("manual")}` : ""}
                      </p>
                      {e.editedReason ? (
                        <p className="text-muted-foreground text-xs italic">
                          {t("edited", { reason: e.editedReason })}
                        </p>
                      ) : null}
                    </div>
                    {mayEdit(e) ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-10"
                        aria-label={t("editLabel", { kind: t(`kind.${e.kind}`), name: e.memberName })}
                        onClick={() => setEditing(e)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
      {editing ? (
        <EntryDialog
          key={editing.id}
          mode="edit"
          jobId={jobId}
          entry={editing}
          timeZone={timeZone}
          members={members}
          canChooseMember={false}
          actorMemberId={actorMemberId}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {adding ? (
        <EntryDialog
          mode="add"
          jobId={jobId}
          timeZone={timeZone}
          members={members}
          canChooseMember={canEditAll}
          actorMemberId={actorMemberId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Card>
  );
}

function EntryDialog({
  mode,
  jobId,
  entry,
  timeZone,
  members,
  canChooseMember,
  actorMemberId,
  onClose,
}: {
  mode: "edit" | "add";
  jobId: string;
  entry?: TimeEntryView;
  timeZone: string;
  members: { id: string; name: string }[];
  canChooseMember: boolean;
  actorMemberId: string;
  onClose: () => void;
}) {
  const t = useTranslations("fieldwork.time");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [start, setStart] = useState(toLocalInput(entry?.startedAt ?? null, timeZone));
  const [end, setEnd] = useState(toLocalInput(entry?.endedAt ?? null, timeZone));
  const [kind, setKind] = useState<TimeEntryKind>(entry?.kind ?? "work");
  const [memberId, setMemberId] = useState(
    members.some((m) => m.id === actorMemberId) ? actorMemberId : (members[0]?.id ?? actorMemberId),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const running = mode === "edit" && !entry?.endedAt;

  const submit = () =>
    startTransition(async () => {
      const started_at = fromLocalInput(start, timeZone);
      const ended_at = end ? fromLocalInput(end, timeZone) : null;
      if (!started_at || (!running && !ended_at)) {
        setError(t("timesRequired"));
        return;
      }
      const r =
        mode === "edit"
          ? await updateTimeEntryAction(entry!.id, { started_at, ended_at, reason })
          : await addTimeEntryAction(jobId, {
              kind,
              started_at,
              ended_at: ended_at!,
              reason,
              ...(canChooseMember ? { member_id: memberId } : {}),
            });
      if (!r.ok) {
        setError(r.error.fields?.[0]?.message ?? r.error.message);
        return;
      }
      toast.success(mode === "edit" ? t("saved") : t("added"));
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{t("dialogHint", { timeZone })}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {mode === "add" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {canChooseMember ? (
                <div className="space-y-1.5">
                  <Label htmlFor="te-member">{t("member")}</Label>
                  <NativeSelect id="te-member" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="te-kind">{t("kindLabel")}</Label>
                <NativeSelect id="te-kind" value={kind} onChange={(e) => setKind(e.target.value as TimeEntryKind)}>
                  <option value="work">{t("kind.work")}</option>
                  <option value="travel">{t("kind.travel")}</option>
                </NativeSelect>
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="te-start">{t("start")}</Label>
              <Input id="te-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="te-end">{t("end")}</Label>
              <Input
                id="te-end"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required={!running}
              />
              {running ? <p className="text-muted-foreground text-xs">{t("runningHint")}</p> : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="te-reason">{t("reason")}</Label>
            <Textarea
              id="te-reason"
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || reason.trim().length < 3}>
              {pending ? <Loader2 className="animate-spin" /> : <Clock />}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
