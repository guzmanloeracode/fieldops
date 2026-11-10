import { createReportModel } from "@fieldops/ai";
import { reports, type AttachmentRecord, type IntakePhoto, type ReportModel } from "@fieldops/core";
import {
  claimPendingReports,
  failReportDraft,
  releaseStuckReports,
  withStore,
  type Database,
} from "@fieldops/db";
import { AI_IMAGE_TYPES, type AiImageType } from "@fieldops/shared";
import { readObject } from "./ai";
import { env } from "./env";
import { log } from "./log";

// AI drafts of service reports (AI-03). Completing a job creates its report with ai_status "pending"; this loop
// claims a few at a time (packages/db repos/reports.ts) and drafts each one with the core service. Without a key
// they are marked "skipped" and keep the text prefilled from the checklist.

export const reportModel: ReportModel = createReportModel({
  apiKey: env.ai.apiKey,
  provider: env.ai.provider,
  reportModel: env.ai.reportModel,
});

const MAX_PHOTO_BYTES = 3_500_000;

/** The model gets small photos: the WebP thumbnail, or the original when there is none and it is small enough. */
export async function loadReportPhotos(attachments: AttachmentRecord[]): Promise<IntakePhoto[]> {
  const photos: IntakePhoto[] = [];
  for (const a of attachments) {
    const original =
      (AI_IMAGE_TYPES as readonly string[]).includes(a.mimeType) && a.sizeBytes <= MAX_PHOTO_BYTES;
    const key = a.thumbKey ?? (original ? a.storageKey : null);
    if (!key) continue;
    try {
      const bytes = await readObject(key);
      photos.push({
        mediaType: (a.thumbKey ? "image/webp" : a.mimeType) as AiImageType,
        data: bytes.toString("base64"),
      });
    } catch (err) {
      log.warn({ err, attachmentId: a.id }, "report photo unreadable; drafting without it");
    }
  }
  return photos;
}

/** Drafts the pending reports. Returns how many it handled. */
export async function draftPendingReports(db: Database, model = reportModel): Promise<number> {
  const claimed = await claimPendingReports(db);
  for (const r of claimed) {
    const status = await reports
      .draftPendingReport(
        (fn) => withStore(db, r.organizationId, (store) => fn(store)),
        model,
        r.jobId,
        loadReportPhotos,
        new Date(),
      )
      .catch(async (err) => {
        log.error({ err, reportId: r.id }, "report draft failed");
        await failReportDraft(db, r.id);
        return "failed" as const;
      });
    log.info({ reportId: r.id, orgId: r.organizationId, status }, "service report drafted");
  }
  return claimed.length;
}

export async function releaseStuckReportDrafts(db: Database): Promise<number> {
  return releaseStuckReports(db);
}
