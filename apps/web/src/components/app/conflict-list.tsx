"use client";
import type { ConflictDto } from "@fieldops/shared";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Reads `details.conflicts` from a failed assign action; null when the error isn't a scheduling conflict. */
export function conflictsOf(error: {
  code: string;
  details?: Record<string, unknown>;
}): ConflictDto[] | null {
  if (error.code !== "conflict" || !Array.isArray(error.details?.conflicts)) return null;
  return error.details.conflicts as ConflictDto[];
}

/**
 * Scheduling conflicts (SCH-03) with the override reason field. Shared by the job page and the dispatch
 * board so both say the same thing.
 */
export function ConflictPanel({
  conflicts,
  reason,
  onReasonChange,
  idPrefix = "conflict",
}: {
  conflicts: ConflictDto[];
  reason: string;
  onReasonChange: (value: string) => void;
  idPrefix?: string;
}) {
  const t = useTranslations("dispatch.conflicts");
  return (
    <div
      className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
      role="alert"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> {t("title")}
      </p>
      <ConflictItems conflicts={conflicts} />
      <p className="text-xs">{t("hint")}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-override`}>{t("reason")}</Label>
        <Textarea
          id={`${idPrefix}-override`}
          rows={2}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="bg-background text-foreground"
        />
      </div>
    </div>
  );
}

export function ConflictItems({ conflicts }: { conflicts: ConflictDto[] }) {
  const t = useTranslations("dispatch.conflicts");
  return (
    <ul className="space-y-1.5" data-testid="conflict-list">
      {conflicts.map((c, i) => (
        <li key={`${c.member_id}-${c.kind}-${i}`} className="leading-snug">
          <span className="font-medium">{c.member_name}</span>
          <span aria-hidden> · </span>
          <span className="sr-only">: </span>
          {c.kind === "overlap" ? (
            <>
              <span>{t("overlap")}</span>{" "}
              {(c.job_numbers ?? []).map((n, k) => (
                <span key={n}>
                  {k ? ", " : "("}
                  <Link href={`/jobs/${n}`} className="underline underline-offset-2" target="_blank">
                    {n}
                  </Link>
                  {k === (c.job_numbers?.length ?? 0) - 1 ? ")" : ""}
                </span>
              ))}
            </>
          ) : c.kind === "missing_skills" ? (
            <span>{t("missing_skills", { skills: (c.missing_skills ?? []).join(", ") })}</span>
          ) : (
            <>
              <span>{t(c.kind)}</span>
              <span className="block text-xs">{c.message}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
