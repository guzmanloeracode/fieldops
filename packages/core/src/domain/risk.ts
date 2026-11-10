import { DEFAULT_SLA_TARGETS, type JobPriority, type JobStatus } from "@fieldops/shared";

// Provisional "at risk" and SLA rules for the 0.2 dashboards. They use the default per-priority targets
// until SLA policies (SLA-01) arrive in 0.3 and every job stores its own deadlines.

export type RiskReason = "response_overdue" | "running_late";

const IN_FLIGHT: readonly JobStatus[] = ["scheduled", "en_route", "in_progress", "on_hold"];

export interface RiskFacts {
  status: JobStatus;
  priority: JobPriority;
  createdAt: Date;
  scheduledEnd: Date | null;
}

/** When the job should have been scheduled with a technician. */
export function responseDeadline(job: Pick<RiskFacts, "priority" | "createdAt">): Date {
  return new Date(job.createdAt.getTime() + DEFAULT_SLA_TARGETS[job.priority].responseMin * 60_000);
}

/**
 * Why an open job needs attention now, or null. Unscheduled jobs are at risk once their response target has
 * passed; scheduled or running jobs once their visit window has ended without completion (DSH-04).
 */
export function riskOf(job: RiskFacts, now: Date): RiskReason | null {
  if (job.status === "new") return responseDeadline(job) < now ? "response_overdue" : null;
  if (IN_FLIGHT.includes(job.status) && job.scheduledEnd && job.scheduledEnd < now) return "running_late";
  return null;
}

/** Whether a completed job met the provisional resolution target of its priority. */
export function metResolutionTarget(
  job: { priority: JobPriority; createdAt: Date },
  completedAt: Date,
): boolean {
  const limit = DEFAULT_SLA_TARGETS[job.priority].resolutionMin * 60_000;
  return completedAt.getTime() - job.createdAt.getTime() <= limit;
}
