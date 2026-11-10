import type { JobPriority, SlaTarget } from "@fieldops/shared";

// SLA policies and the monitor (SLA-01–03).

export interface SlaPolicyRecord {
  id: string;
  priority: JobPriority;
  responseMin: number;
  resolutionMin: number;
  businessHours: boolean;
}

/** An alert the monitor raised for the first time, with what the notification needs. */
export interface SlaAlertRaised {
  jobId: string;
  number: number;
  title: string;
  customerName: string;
  target: SlaTarget;
  kind: "at_risk" | "breached";
  dueAt: Date | null;
}

export interface SlaRepo {
  /** The organization's policies; priorities without a row use DEFAULT_SLA_TARGETS. */
  listPolicies(): Promise<SlaPolicyRecord[]>;
  /** Inserts or replaces the policy of each given priority. */
  savePolicies(rows: Omit<SlaPolicyRecord, "id">[]): Promise<SlaPolicyRecord[]>;
  /**
   * Moves open jobs to the state their stored deadlines give at `now` (on track → at risk → breached).
   * Returns the number of jobs that changed.
   */
  advanceStates(now: Date): Promise<number>;
  /**
   * Records an alert for every open target that is at risk or breached and returns only the alerts that
   * weren't raised before (one per job, target and kind; SLA-03).
   */
  raiseAlerts(now: Date): Promise<SlaAlertRaised[]>;
}
