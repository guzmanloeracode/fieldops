"use client";
import type { AiReviewField, AiStatus } from "@fieldops/shared";
import { AlertTriangle, Check, Inbox, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { reviewJobAction } from "./ai-actions";

export interface ReviewRow {
  field: AiReviewField;
  label: string;
  current: string;
  suggested: string;
  /** The AI wasn't sure: unticked by default. */
  low: boolean;
}

export function AiReviewPanel({
  jobId,
  aiStatus,
  rows,
  summary,
  priorityReason,
  questions,
}: {
  jobId: string;
  aiStatus: AiStatus | null;
  rows: ReviewRow[];
  summary: string | null;
  priorityReason: string | null;
  questions: string[];
}) {
  const t = useTranslations("ai.review");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<AiReviewField[]>(rows.filter((r) => !r.low).map((r) => r.field));
  const chosen = selected.filter((f) => rows.some((r) => r.field === f));

  const run = (input: { apply: AiReviewField[]; confirm: boolean }, done: string) =>
    startTransition(async () => {
      const r = await reviewJobAction(jobId, input);
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(done);
      router.refresh();
    });

  const drafting = aiStatus === "pending" || aiStatus === "drafting";
  // The worker drafts within seconds; check back a few times so the draft appears without a reload.
  useEffect(() => {
    if (!drafting) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n > 15) clearInterval(id);
      else router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [drafting, router]);

  return (
    <Card data-testid="ai-review" className="border-amber-300 dark:border-amber-800">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Inbox className="size-4" aria-hidden /> {t("title")}
          {rows.length || summary ? (
            <Badge variant="secondary">
              <Sparkles aria-hidden /> {t("badge")}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {drafting
            ? t("drafting")
            : aiStatus === "failed"
              ? t("failed")
              : aiStatus === "skipped"
                ? t("skipped")
                : rows.length
                  ? t("description")
                  : summary
                    ? t("nothingToApply")
                    : t("noDraft")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {drafting ? (
          <p className="text-muted-foreground flex items-center gap-2" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t("draftingHint")}
          </p>
        ) : null}
        {summary ? (
          <div className="space-y-1">
            <p className="font-medium">{t("summary")}</p>
            <p className="text-muted-foreground whitespace-pre-line">{summary}</p>
            {priorityReason ? (
              <p className="text-muted-foreground">{t("priorityReason", { reason: priorityReason })}</p>
            ) : null}
          </div>
        ) : null}
        {rows.length ? (
          <fieldset>
            <legend className="sr-only">{t("legend")}</legend>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2">
                      <span className="sr-only">{t("apply")}</span>
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("field")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("current")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("suggested")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const id = `review-${r.field}`;
                    return (
                      <tr key={r.field} className="border-t align-top" data-testid={`review-row-${r.field}`}>
                        <td className="px-3 py-2">
                          <Checkbox
                            id={id}
                            checked={selected.includes(r.field)}
                            onCheckedChange={(v) =>
                              setSelected((s) => (v ? [...s, r.field] : s.filter((f) => f !== r.field)))
                            }
                            aria-label={t("applyField", { field: r.label })}
                          />
                        </td>
                        <th scope="row" className="px-3 py-2 font-medium">
                          <label htmlFor={id}>{r.label}</label>
                        </th>
                        <td className="text-muted-foreground px-3 py-2">{r.current}</td>
                        <td className="px-3 py-2">
                          {r.suggested}
                          {r.low ? (
                            <span className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                              <AlertTriangle className="size-3" aria-hidden /> {t("lowConfidence")}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>
        ) : null}
        {questions.length ? (
          <div>
            <p className="font-medium">{t("questions")}</p>
            <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-5">
              {questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {rows.length ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending || chosen.length === 0}
              onClick={() => run({ apply: chosen, confirm: false }, t("applied", { count: chosen.length }))}
              data-testid="review-apply"
            >
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles aria-hidden />}
              {t("applySelected", { count: chosen.length })}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={pending}
            onClick={() => run({ apply: [], confirm: true }, t("confirmed"))}
            data-testid="review-confirm"
          >
            {pending ? <Loader2 className="animate-spin" /> : <Check aria-hidden />}
            {t("confirm")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
