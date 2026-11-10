"use client";
import { PRIORITY_LABELS } from "@fieldops/core";
import { JOB_PRIORITIES, type JobPriority } from "@fieldops/shared";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { deleteJobAction, updateJobAction } from "../actions";

type Job = {
  id: string;
  version: number;
  title: string;
  description: string | null;
  priority: JobPriority;
  serviceTypeId: string | null;
  estimatedDurationMin: number | null;
  preferredStart: string | null;
  preferredEnd: string | null;
};

export function JobMenu({
  job,
  serviceTypes,
  canDelete,
  timeZone,
}: {
  job: Job;
  serviceTypes: { id: string; name: string }[];
  canDelete: boolean;
  timeZone: string;
}) {
  const t = useTranslations("jobs");
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: job.title,
    description: job.description ?? "",
    priority: job.priority,
    service_type_id: job.serviceTypeId ?? "none",
    estimated_duration_min: job.estimatedDurationMin ? String(job.estimatedDurationMin) : "",
    preferred_start: toLocalInput(job.preferredStart, timeZone),
    preferred_end: toLocalInput(job.preferredEnd, timeZone),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () =>
    startTransition(async () => {
      const r = await updateJobAction(
        job.id,
        {
          title: form.title,
          description: form.description,
          priority: form.priority,
          service_type_id: form.service_type_id === "none" ? null : form.service_type_id,
          estimated_duration_min: form.estimated_duration_min ? Number(form.estimated_duration_min) : null,
          preferred_start: fromLocalInput(form.preferred_start, timeZone),
          preferred_end: fromLocalInput(form.preferred_end, timeZone),
        },
        job.version,
      );
      if (!r.ok) {
        setErrors(Object.fromEntries((r.error.fields ?? []).map((f) => [f.path, f.message])));
        toast.error(r.error.message);
        return;
      }
      toast.success(t("edit.saved"));
      setEditOpen(false);
      router.refresh();
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="size-10" aria-label={t("more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="size-4" /> {t("edit.title")}
          </DropdownMenuItem>
          {canDelete ? (
            <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" /> {t("delete.title")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("edit.title")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">{t("new.jobTitle")}</Label>
              <Input
                id="edit-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              {errors.title ? <p className="text-destructive text-xs">{errors.title}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">{t("new.descriptionLabel")}</Label>
              <Textarea
                id="edit-description"
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-priority">{t("col.priority")}</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v as JobPriority })}
                >
                  <SelectTrigger id="edit-priority" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-service">{t("col.serviceType")}</Label>
                <Select
                  value={form.service_type_id}
                  onValueChange={(v) => setForm({ ...form, service_type_id: v })}
                >
                  <SelectTrigger id="edit-service" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("new.noServiceType")}</SelectItem>
                    {serviceTypes.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-start">{t("new.preferredStart")}</Label>
                <Input
                  id="edit-start"
                  type="datetime-local"
                  value={form.preferred_start}
                  onChange={(e) => setForm({ ...form, preferred_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-end">{t("new.preferredEnd")}</Label>
                <Input
                  id="edit-end"
                  type="datetime-local"
                  value={form.preferred_end}
                  onChange={(e) => setForm({ ...form, preferred_end: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-duration">{t("new.duration")}</Label>
                <Input
                  id="edit-duration"
                  type="number"
                  min={5}
                  step={5}
                  value={form.estimated_duration_min}
                  onChange={(e) => setForm({ ...form, estimated_duration_min: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("edit.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delete.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() =>
                startTransition(async () => {
                  const r = await deleteJobAction(job.id);
                  if (!r.ok) {
                    toast.error(r.error.message);
                    return;
                  }
                  toast.success(t("delete.done"));
                  router.push("/jobs");
                })
              }
            >
              {t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
