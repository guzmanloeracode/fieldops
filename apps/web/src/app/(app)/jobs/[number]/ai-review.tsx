import { ai, organization, PRIORITY_LABELS } from "@fieldops/core";
import { LOW_CONFIDENCE, type AiReviewField, type IntakeConfidenceField } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { requireActor, runService } from "@/server/context";
import { AiReviewPanel, type ReviewRow } from "./ai-review-panel";

const CONFIDENCE: Record<AiReviewField, IntakeConfidenceField | null> = {
  title: "title",
  service_type_id: "service_type",
  priority: "priority",
  estimated_duration_min: "estimated_duration",
  checklist: null,
};

/**
 * "Needs review" panel for portal requests (AI-01): the AI's suggestions next to the request as it is, to apply
 * field by field before confirming. Office roles; loads its own data, like the other job page sections.
 */
export async function AiReview({ jobId }: { jobId: string }) {
  const actor = await requireActor();
  const t = await getTranslations("ai.review");
  const data = await runService(async (ctx) => {
    const [review, types] = await Promise.all([ai.getReview(ctx, jobId), organization.listServiceTypes(ctx)]);
    return { review, types };
  }, actor);
  const { review } = data;
  const job = review.job;
  const typeName = (id: string | null) => data.types.find((s) => s.id === id)?.name ?? "—";
  const minutes = (n: number | null) => (n ? t("minutes", { n }) : "—");
  const draft = review.draft;
  const offered = draft ? ai.reviewChanges(draft, job, review.checklist) : [];
  const rows: ReviewRow[] = draft
    ? offered.map((field) => {
        const c = CONFIDENCE[field];
        const low = c ? draft.confidence[c] < LOW_CONFIDENCE : false;
        const values: Record<AiReviewField, [string, string]> = {
          title: [job.title, draft.title],
          service_type_id: [typeName(job.serviceTypeId), typeName(draft.service_type_id)],
          priority: [PRIORITY_LABELS[job.priority], PRIORITY_LABELS[draft.priority]],
          estimated_duration_min: [minutes(job.estimatedDurationMin), minutes(draft.estimated_duration_min)],
          checklist: [
            t("checklistNow"),
            draft.checklist
              .filter((l) => !review.checklist.some((c) => c.toLowerCase() === l.toLowerCase()))
              .join("; "),
          ],
        };
        return {
          field,
          label: t(`fields.${field}`),
          current: values[field][0],
          suggested: values[field][1],
          low,
        };
      })
    : [];
  return (
    <AiReviewPanel
      jobId={job.id}
      aiStatus={job.aiStatus}
      rows={rows}
      summary={draft?.summary ?? null}
      priorityReason={draft?.priority_reason ?? null}
      questions={draft?.questions ?? []}
    />
  );
}
