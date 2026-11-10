import type { JobPriority } from "@fieldops/shared";

export const PRIORITY_RANK: Record<JobPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
export const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function comparePriority(a: JobPriority, b: JobPriority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}
