"use client";
import { HOLD_REASONS, JOB_STATUSES, type HoldReason, type JobStatus } from "@fieldops/shared";
import { Download, Loader2, UserPlus, Workflow, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { bulkJobsAction } from "./insights-actions";

type Option = { id: string; name: string };
type Skipped = { id: string; number: string | null; message?: string };

/** Bulk actions on the selected jobs (JOB-04): assign, change status, export. */
export function BulkBar({
  ids,
  members,
  onClear,
}: {
  ids: string[];
  members: Option[];
  onClear: () => void;
}) {
  const t = useTranslations("insights.bulk");
  const tj = useTranslations("jobs");
  const tStatus = useTranslations("common.status");
  const router = useRouter();
  const [dialog, setDialog] = useState<"assign" | "status" | null>(null);
  const [memberId, setMemberId] = useState("");
  const [to, setTo] = useState<JobStatus | "">("");
  const [reason, setReason] = useState("");
  const [holdReason, setHoldReason] = useState<HoldReason | "">("");
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (input: Record<string, unknown>) =>
    startTransition(async () => {
      const res = await bulkJobsAction({ ...input, ids });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      const text = t("result", { updated: res.data.updated, skipped: res.data.skipped });
      setSummary(text);
      setSkipped(res.data.results.filter((r) => !r.ok));
      if (res.data.updated > 0) toast.success(text);
      else toast.warning(text);
      setDialog(null);
      setReason("");
      onClear();
      router.refresh();
    });

  return (
    <div className="space-y-2">
      {ids.length ? (
        <div
          className="bg-primary/5 border-primary/30 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
          data-testid="bulk-bar"
        >
          <span className="text-sm font-medium" aria-live="polite">
            {t("selected", { count: ids.length })}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog("assign")} data-testid="bulk-assign">
              <UserPlus /> {t("assign")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("status")} data-testid="bulk-status">
              <Workflow /> {t("status")}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/jobs/export?ids=${ids.join(",")}`} download data-testid="bulk-export">
                <Download /> {t("export")}
              </a>
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear}>
              <X /> {t("clear")}
            </Button>
          </div>
        </div>
      ) : null}

      {summary && skipped.length ? (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          data-testid="bulk-skipped"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">
              {summary} · {t("skippedTitle")}
            </p>
            <Button size="icon-sm" variant="ghost" aria-label={t("dismiss")} onClick={() => setSkipped([])}>
              <X />
            </Button>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {skipped.map((s) => (
              <li key={s.id}>
                <span className="font-mono text-xs">{s.number ?? s.id.slice(0, 8)}</span>: {s.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={dialog === "assign"} onOpenChange={(o) => setDialog(o ? "assign" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("assignTitle")}</DialogTitle>
            <DialogDescription>{t("assignDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-member">{t("technician")}</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger id="bulk-member" className="w-full">
                <SelectValue placeholder={t("chooseTechnician")} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              disabled={!memberId || pending}
              onClick={() => run({ action: "assign", member_id: memberId })}
              data-testid="bulk-assign-apply"
            >
              {pending ? <Loader2 className="animate-spin" /> : null} {t("apply", { count: ids.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "status"} onOpenChange={(o) => setDialog(o ? "status" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("statusTitle")}</DialogTitle>
            <DialogDescription>{t("statusDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!to) return;
              run({
                action: "transition",
                to,
                reason: reason.trim() || null,
                hold_reason: to === "on_hold" && holdReason ? holdReason : null,
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="bulk-to">{t("to")}</Label>
              <Select value={to} onValueChange={(v) => setTo(v as JobStatus)}>
                <SelectTrigger id="bulk-to" className="w-full">
                  <SelectValue placeholder={t("chooseStatus")} />
                </SelectTrigger>
                <SelectContent>
                  {JOB_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tStatus(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {to === "on_hold" ? (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-hold">{t("holdReason")}</Label>
                <Select value={holdReason} onValueChange={(v) => setHoldReason(v as HoldReason)}>
                  <SelectTrigger id="bulk-hold" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOLD_REASONS.map((h) => (
                      <SelectItem key={h} value={h}>
                        {tj(`holdReason.${h}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="bulk-reason">{t("reason")}</Label>
              <Textarea
                id="bulk-reason"
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="bulk-reason-hint"
              />
              <p id="bulk-reason-hint" className="text-muted-foreground text-xs">
                {t("reasonHint")}
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!to || pending} data-testid="bulk-status-apply">
                {pending ? <Loader2 className="animate-spin" /> : null} {t("apply", { count: ids.length })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
