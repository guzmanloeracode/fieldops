import type { JobPriority } from "@fieldops/shared";

// SLA policies and the monitor (SLA-01–03). The SLA slice extends these contracts.

export interface SlaPolicyRecord {
  id: string;
  priority: JobPriority;
  responseMin: number;
  resolutionMin: number;
  businessHours: boolean;
}

export interface SlaRepo {
  /** The organization's policies; priorities without a row use DEFAULT_SLA_TARGETS. */
  listPolicies(): Promise<SlaPolicyRecord[]>;
}
