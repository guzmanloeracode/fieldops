"use client";
import type { ConflictDto, JobAssignmentInput } from "@fieldops/shared";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { ConflictPanel, conflictsOf } from "./conflict-list";

export type AssignResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fields?: { path: string; message: string }[];
        details?: Record<string, unknown>;
      };
    };

export interface AssignMember {
  id: string;
  name: string;
  role: string;
}

/**
 * Technicians (one lead, helpers — JOB-09) and the visit window, with the scheduling conflicts (SCH-03)
 * and the override reason. Used in the job page's dialog and the dispatch board's reschedule dialog.
 */
export function AssignForm<T>(props: {
  idPrefix: string;
  timeZone: string;
  members: AssignMember[];
  memberIds: string[];
  leadId: string | null;
  start: string | null;
  end: string | null;
  estimatedDurationMin: number | null;
  onSubmit: (input: JobAssignmentInput) => Promise<AssignResult<T>>;
  onSaved: (data: T) => void;
  onCancel: () => void;
  footerStart?: ReactNode;
}) {
  const t = useTranslations("jobs");
  const tc = useTranslations("dispatch.conflicts");
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(props.memberIds);
  const [lead, setLead] = useState<string>(props.leadId ?? props.memberIds[0] ?? "");
  const [start, setStart] = useState(toLocalInput(props.start, props.timeZone));
  const [end, setEnd] = useState(toLocalInput(props.end, props.timeZone));
  const [conflicts, setConflicts] = useState<ConflictDto[] | null>(null);
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const p = props.idPrefix;

  // Any change makes the old conflict list stale.
  const changed = () => {
    setConflicts(null);
    setOverride("");
  };

  const toggle = (id: string) => {
    changed();
    setSelected((s) => {
      const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
      if (!next.includes(lead)) setLead(next[0] ?? "");
      return next;
    });
  };

  const onStartChange = (v: string) => {
    changed();
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
      const result = await props.onSubmit({
        member_ids: selected,
        lead_member_id: lead || null,
        scheduled_start: fromLocalInput(start, props.timeZone),
        scheduled_end: fromLocalInput(end, props.timeZone),
        override_reason: conflicts ? override.trim() || null : null,
      });
      if (!result.ok) {
        const found = conflictsOf(result.error);
        if (found) {
          setConflicts(found);
          return;
        }
        setError(result.error.fields?.[0]?.message ?? result.error.message);
        return;
      }
      setConflicts(null);
      setOverride("");
      props.onSaved(result.data);
    });

  return (
    <>
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
            <RadioGroup
              value={lead}
              onValueChange={(v) => {
                changed();
                setLead(v);
              }}
              className="flex flex-wrap gap-2"
            >
              {selected.map((id) => (
                <label key={id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <RadioGroupItem value={id} /> {props.members.find((m) => m.id === id)?.name}
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${p}-start`}>{t("assign.start")}</Label>
            <Input
              id={`${p}-start`}
              type="datetime-local"
              value={start}
              onChange={(e) => onStartChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${p}-end`}>{t("assign.end")}</Label>
            <Input
              id={`${p}-end`}
              type="datetime-local"
              value={end}
              onChange={(e) => {
                changed();
                setEnd(e.target.value);
              }}
            />
          </div>
        </div>
        {conflicts ? (
          <ConflictPanel conflicts={conflicts} reason={override} onReasonChange={setOverride} idPrefix={p} />
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {props.footerStart ? <div className="sm:mr-auto">{props.footerStart}</div> : null}
        <Button variant="outline" onClick={props.onCancel}>
          {t("cancel")}
        </Button>
        <Button
          onClick={save}
          disabled={pending || (Boolean(conflicts) && !override.trim())}
          data-testid="assign-save"
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {conflicts ? tc("saveAnyway") : t("assign.save")}
        </Button>
      </div>
    </>
  );
}
