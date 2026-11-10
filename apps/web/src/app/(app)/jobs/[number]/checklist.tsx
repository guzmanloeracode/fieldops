"use client";
import type { ChecklistItemKind } from "@fieldops/shared";
import { Camera, CheckCircle2, Circle, ImageIcon, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateChecklistAction } from "./fieldwork-actions";
import { uploadToJob } from "./upload";

export type ChecklistItemView = {
  id: string;
  label: string;
  kind: ChecklistItemKind;
  unit: string | null;
  required: boolean;
  value: boolean | number | string | null;
  doneAt: string | null;
  doneBy: string | null;
};

export type PhotoOption = { id: string; fileName: string; url: string | null; thumbUrl: string | null };

/** The job's checklist (JOB-08): large tap targets, one save per answer. */
export function Checklist({
  jobId,
  items,
  photos,
  canEdit,
  timeZone,
}: {
  jobId: string;
  items: ChecklistItemView[];
  photos: PhotoOption[];
  canEdit: boolean;
  timeZone: string;
}) {
  const t = useTranslations("fieldwork.checklist");
  const done = items.filter((i) => i.doneAt).length;
  const requiredLeft = items.filter((i) => i.required && !i.doneAt).length;
  if (!items.length) return null;
  return (
    <Card data-testid="checklist">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <p className="text-muted-foreground text-sm" data-testid="checklist-progress">
            {t("progress", { done, total: items.length })}
            {requiredLeft ? ` · ${t("requiredLeft", { count: requiredLeft })}` : ""}
          </p>
        </div>
        <div
          className="bg-muted h-1.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-label={t("title")}
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={done}
        >
          <div
            className="bg-primary h-full transition-all"
            style={{ width: `${(done / items.length) * 100}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0" data-testid="checklist-item">
              <Row jobId={jobId} item={item} photos={photos} canEdit={canEdit} timeZone={timeZone} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Row({
  jobId,
  item,
  photos,
  canEdit,
  timeZone,
}: {
  jobId: string;
  item: ChecklistItemView;
  photos: PhotoOption[];
  canEdit: boolean;
  timeZone: string;
}) {
  const t = useTranslations("fieldwork.checklist");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const id = useId();
  const isDone = Boolean(item.doneAt);

  const save = (value: ChecklistItemView["value"], onDone?: () => void) =>
    startTransition(async () => {
      const r = await updateChecklistAction(jobId, { items: [{ id: item.id, value }] });
      if (!r.ok) {
        toast.error(r.error.fields?.[0]?.message ?? r.error.message);
        return;
      }
      onDone?.();
      router.refresh();
    });

  const meta = (
    <p className="text-muted-foreground mt-1 text-xs">
      {isDone
        ? t("doneBy", { name: item.doneBy ?? t("someone"), when: formatDateTime(item.doneAt, timeZone) })
        : item.required
          ? t("required")
          : t("optional")}
    </p>
  );

  if (item.kind === "checkbox") {
    return (
      <label
        htmlFor={id}
        className={cn(
          "-mx-2 flex min-h-11 items-start gap-3 rounded-md px-2 py-1",
          canEdit && "hover:bg-muted/60 cursor-pointer",
        )}
      >
        <Checkbox
          id={id}
          className="mt-0.5 size-6"
          checked={isDone}
          disabled={!canEdit || pending}
          onCheckedChange={(v) => save(v === true)}
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{item.label}</span>
          {meta}
        </span>
        {pending ? <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden /> : null}
      </label>
    );
  }

  const status = isDone ? (
    <CheckCircle2
      className="mt-0.5 size-6 shrink-0 text-green-700 dark:text-green-500"
      aria-label={t("done")}
    />
  ) : (
    <Circle className="text-muted-foreground mt-0.5 size-6 shrink-0" aria-label={t("notDone")} />
  );

  return (
    <div className="flex items-start gap-3">
      {status}
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <label htmlFor={id} className="font-medium">
            {item.label}
            {item.unit ? <span className="text-muted-foreground font-normal"> ({item.unit})</span> : null}
          </label>
          {meta}
        </div>
        {item.kind === "photo" ? (
          <PhotoAnswer
            jobId={jobId}
            item={item}
            photos={photos}
            canEdit={canEdit}
            inputId={id}
            save={save}
            pending={pending}
          />
        ) : (
          <ValueAnswer item={item} canEdit={canEdit} inputId={id} save={save} pending={pending} />
        )}
      </div>
    </div>
  );
}

function ValueAnswer({
  item,
  canEdit,
  inputId,
  save,
  pending,
}: {
  item: ChecklistItemView;
  canEdit: boolean;
  inputId: string;
  save: (value: ChecklistItemView["value"], onDone?: () => void) => void;
  pending: boolean;
}) {
  const t = useTranslations("fieldwork.checklist");
  const initial = item.value === null || item.value === undefined ? "" : String(item.value);
  const [value, setValue] = useState(initial);
  const dirty = value.trim() !== initial;
  if (!canEdit) {
    return <p className="text-sm whitespace-pre-line">{initial || "—"}</p>;
  }
  const submit = () => {
    if (!dirty) return;
    if (item.kind === "number") {
      const n = value.trim() === "" ? null : Number(value.replace(",", "."));
      if (n !== null && !Number.isFinite(n)) {
        toast.error(t("numberInvalid"));
        return;
      }
      save(n);
    } else save(value.trim() === "" ? null : value);
  };
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {item.kind === "number" ? (
        <Input
          id={inputId}
          inputMode="decimal"
          className="h-11 max-w-40 text-base"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={item.unit ? `${inputId}-unit` : undefined}
        />
      ) : (
        <Textarea
          id={inputId}
          rows={2}
          className="min-h-11 text-base"
          maxLength={2000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      {item.kind === "number" && item.unit ? (
        <span id={`${inputId}-unit`} className="text-muted-foreground self-center text-sm">
          {item.unit}
        </span>
      ) : null}
      {dirty ? (
        <Button type="submit" className="h-11" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {t("save")}
        </Button>
      ) : null}
    </form>
  );
}

function PhotoAnswer({
  jobId,
  item,
  photos,
  canEdit,
  inputId,
  save,
  pending,
}: {
  jobId: string;
  item: ChecklistItemView;
  photos: PhotoOption[];
  canEdit: boolean;
  inputId: string;
  save: (value: ChecklistItemView["value"], onDone?: () => void) => void;
  pending: boolean;
}) {
  const t = useTranslations("fieldwork.checklist");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const linked = typeof item.value === "string" ? photos.find((p) => p.id === item.value) : undefined;

  const take = async (file: File) => {
    setBusy(true);
    const r = await uploadToJob(jobId, file, {
      fileName: file.name || "photo.jpg",
      kind: "photo",
      tag: "after",
      failedMessage: t("uploadFailed"),
    });
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!r.ok) toast.error(r.message);
    else save(r.attachmentId);
  };

  return (
    <div className="space-y-2">
      {linked ? (
        <a href={linked.url ?? "#"} target="_blank" rel="noreferrer" className="inline-block">
          <img
            src={linked.thumbUrl ?? linked.url ?? ""}
            alt={t("photoOf", { label: item.label })}
            className="h-24 w-32 rounded-md border object-cover"
          />
        </a>
      ) : item.doneAt ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <ImageIcon className="size-4" aria-hidden /> {t("photoRecorded")}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && void take(e.target.files[0])}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy || pending}
            onClick={() => input.current?.click()}
          >
            {busy || pending ? <Loader2 className="animate-spin" /> : <Camera />}
            {item.doneAt ? t("retake") : t("takePhoto")}
          </Button>
          {photos.length ? (
            <NativeSelect
              aria-label={t("choosePhoto", { label: item.label })}
              className="w-48"
              value=""
              disabled={busy || pending}
              onChange={(e) => e.target.value && save(e.target.value)}
            >
              <option value="">{t("chooseExisting")}</option>
              {photos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fileName}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {item.doneAt ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              disabled={pending}
              onClick={() => save(null)}
            >
              <X /> {t("clear")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
