"use client";
import type { AiStatus, Locale, ReportStatus } from "@fieldops/shared";
import { Download, Eye, FileText, Loader2, Save, Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/app/native-select";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import {
  draftReportAction,
  reportStatusAction,
  saveReportAction,
  sendReportAction,
  startReportAction,
} from "./report-actions";

export interface ReportView {
  status: ReportStatus;
  locale: Locale;
  workPerformed: string;
  findings: string;
  recommendations: string;
  nextServiceDate: string;
  aiStatus: AiStatus | null;
  aiDrafted: boolean;
  edited: boolean;
  sentAt: string | null;
  sentTo: string | null;
  version: number;
}

type Fields = Pick<
  ReportView,
  "workPerformed" | "findings" | "recommendations" | "nextServiceDate" | "locale"
>;
const FIELDS = ["workPerformed", "findings", "recommendations", "nextServiceDate", "locale"] as const;

/** The service report on the job page (AI-03): phone-first, one column, actions that wrap. */
export function ServiceReportPanel({
  jobId,
  report,
  canWrite,
  aiAvailable,
  contacts,
  timeZone,
}: {
  jobId: string;
  report: ReportView | null;
  canWrite: boolean;
  aiAvailable: boolean;
  contacts: { name: string; email: string; isPrimary: boolean }[];
  timeZone: string;
}) {
  const t = useTranslations("reports");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const saved: Fields | null = report
    ? {
        workPerformed: report.workPerformed,
        findings: report.findings,
        recommendations: report.recommendations,
        nextServiceDate: report.nextServiceDate,
        locale: report.locale,
      }
    : null;
  const [fields, setFields] = useState<Fields | null>(saved);
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [to, setTo] = useState(contacts.find((c) => c.isPrimary)?.email ?? contacts[0]?.email ?? "");
  const dirty = Boolean(saved && fields && FIELDS.some((k) => saved[k] !== fields[k]));
  const drafting = report?.aiStatus === "pending" || report?.aiStatus === "drafting";

  // The worker drafts within seconds; check its status a few times and reload the page's data only once it has
  // changed. Stop as soon as someone starts typing, so a refresh never replaces what they wrote.
  const version = report?.version;
  useEffect(() => {
    if (!drafting || dirty) return;
    let n = 0;
    let active = true;
    const id = setInterval(async () => {
      n += 1;
      if (n > 24) return clearInterval(id);
      const r = await reportStatusAction(jobId);
      if (
        active &&
        r.ok &&
        r.data &&
        (r.data.version !== version || !["pending", "drafting"].includes(r.data.aiStatus ?? ""))
      ) {
        clearInterval(id);
        router.refresh();
      }
    }, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [drafting, dirty, router, jobId, version]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>, done?: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      if (done) toast.success(done);
      router.refresh();
    });

  const save = () =>
    fields &&
    report &&
    run(
      () =>
        saveReportAction(
          jobId,
          {
            work_performed: fields.workPerformed,
            findings: fields.findings,
            recommendations: fields.recommendations,
            next_service_date: fields.nextServiceDate || null,
            locale: fields.locale,
          },
          report.version,
        ),
      t("saved"),
    );

  const redraft = () =>
    startTransition(async () => {
      const r = await draftReportAction(jobId);
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      if (r.data.status === "drafted") toast.success(t("drafted"));
      else toast.error(r.data.status === "refused" ? t("refused") : t("draftFailed"));
      router.refresh();
    });

  const send = () =>
    startTransition(async () => {
      const r = await sendReportAction(jobId, to);
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      setSendOpen(false);
      toast.success(t("sentToast", { to: r.data.sentTo ?? to }));
      router.refresh();
    });

  const pdf = `/api/v1/jobs/${jobId}/report/pdf`;
  const description = !report
    ? t("none")
    : drafting
      ? t("ai.drafting")
      : report.status === "sent"
        ? t("sentTo", { to: report.sentTo ?? "", date: formatDateTime(report.sentAt, timeZone) })
        : report.sentAt
          ? t("changedSinceSent", { date: formatDateTime(report.sentAt, timeZone) })
          : report.aiStatus === "failed"
            ? t("ai.failed")
            : report.aiDrafted
              ? t("ai.drafted")
              : t("ai.prefilled");

  return (
    <Card data-testid="service-report">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <FileText className="size-4" aria-hidden /> {t("title")}
          {report ? (
            <Badge variant={report.status === "sent" ? "default" : "outline"} data-testid="report-status">
              {t(`status.${report.status}`)}
            </Badge>
          ) : null}
          {report?.aiDrafted ? (
            <Badge variant="secondary">
              <Sparkles aria-hidden /> {report.edited ? t("ai.badgeEdited") : t("ai.badge")}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {drafting ? (
          <p className="text-muted-foreground flex items-center gap-2" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t("ai.draftingHint")}
          </p>
        ) : null}

        {!report || !fields ? (
          canWrite ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() => run(() => startReportAction(jobId), t("started"))}
              data-testid="report-start"
            >
              {pending ? <Loader2 className="animate-spin" /> : <FileText aria-hidden />}
              {t("start")}
            </Button>
          ) : null
        ) : canWrite ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <TextField
              id="report-work"
              label={t("fields.workPerformed")}
              value={fields.workPerformed}
              onChange={(v) => setFields({ ...fields, workPerformed: v })}
              rows={5}
              required
            />
            <TextField
              id="report-findings"
              label={t("fields.findings")}
              value={fields.findings}
              onChange={(v) => setFields({ ...fields, findings: v })}
            />
            <TextField
              id="report-recommendations"
              label={t("fields.recommendations")}
              value={fields.recommendations}
              onChange={(v) => setFields({ ...fields, recommendations: v })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-next">{t("fields.nextServiceDate")}</Label>
                <Input
                  id="report-next"
                  type="date"
                  value={fields.nextServiceDate}
                  onChange={(e) => setFields({ ...fields, nextServiceDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-locale">{t("fields.locale")}</Label>
                <NativeSelect
                  id="report-locale"
                  value={fields.locale}
                  onChange={(e) => setFields({ ...fields, locale: e.target.value as Locale })}
                >
                  <option value="en">{t("locales.en")}</option>
                  <option value="id">{t("locales.id")}</option>
                </NativeSelect>
              </div>
            </div>
            {report.status === "sent" && dirty ? (
              <p className="text-muted-foreground text-xs">{t("editingSent")}</p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !dirty} data-testid="report-save">
                {pending ? <Loader2 className="animate-spin" /> : <Save aria-hidden />}
                {t("save")}
              </Button>
            </div>
          </form>
        ) : (
          <dl className="space-y-3">
            {(
              [
                ["workPerformed", report.workPerformed],
                ["findings", report.findings],
                ["recommendations", report.recommendations],
                ["nextServiceDate", report.nextServiceDate],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground text-xs">{t(`fields.${k}`)}</dt>
                  <dd className="mt-0.5 whitespace-pre-line">{v}</dd>
                </div>
              ))}
          </dl>
        )}

        {report ? (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {canWrite && aiAvailable ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => (report.edited || dirty ? setConfirmRedraft(true) : redraft())}
                data-testid="report-draft-ai"
              >
                {pending ? <Loader2 className="animate-spin" /> : <Sparkles aria-hidden />}
                {report.aiDrafted ? t("regenerate") : t("draftWithAi")}
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <a href={pdf} target="_blank" rel="noreferrer" data-testid="report-preview">
                <Eye aria-hidden /> {t("preview")}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`${pdf}?download=1`} download data-testid="report-download">
                <Download aria-hidden /> {t("download")}
              </a>
            </Button>
            {canWrite ? (
              <Button
                type="button"
                disabled={pending || dirty || !report.workPerformed.trim()}
                onClick={() => setSendOpen(true)}
                data-testid="report-send"
              >
                <Send aria-hidden /> {report.status === "sent" ? t("sendAgain") : t("send")}
              </Button>
            ) : null}
            {dirty ? <p className="text-muted-foreground w-full text-xs">{t("saveFirst")}</p> : null}
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmRedraft} onOpenChange={setConfirmRedraft}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("redraftTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("redraftDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRedraft(false);
                redraft();
              }}
            >
              {t("regenerate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sendTitle")}</DialogTitle>
            <DialogDescription>{t("sendDescription")}</DialogDescription>
          </DialogHeader>
          {contacts.length ? (
            <RadioGroup value={to} onValueChange={setTo} aria-label={t("recipient")} className="gap-2">
              {contacts.map((c) => (
                <div key={c.email} className="flex items-center gap-3 rounded-md border p-3">
                  <RadioGroupItem value={c.email} id={`report-to-${c.email}`} />
                  <Label
                    htmlFor={`report-to-${c.email}`}
                    className="flex flex-col items-start gap-0.5 font-normal"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground text-xs">{c.email}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noContacts")}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSendOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={pending || !to} onClick={send} data-testid="report-send-confirm">
              {pending ? <Loader2 className="animate-spin" /> : <Send aria-hidden />}
              {t("sendConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  rows = 3,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        required={required}
        maxLength={5000}
        onChange={(e) => onChange(e.target.value)}
        data-testid={id}
      />
    </div>
  );
}
