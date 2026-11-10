import type { ServiceReportRecord } from "@fieldops/core";
import type { ServiceReportDto } from "@fieldops/shared";

/** A service report as the API returns it (AI-03). */
export function toReportDto(r: ServiceReportRecord): ServiceReportDto {
  return {
    id: r.id,
    job_id: r.jobId,
    status: r.status,
    locale: r.locale,
    work_performed: r.workPerformed,
    findings: r.findings,
    recommendations: r.recommendations,
    next_service_date: r.nextServiceDate,
    ai_status: r.aiStatus,
    ai_drafted: r.aiDrafted,
    edited: r.editedBy !== null,
    sent_at: r.sentAt?.toISOString() ?? null,
    sent_to: r.sentTo,
    version: r.version,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export const reportEtag = (version: number) => `"r${version}"`;
