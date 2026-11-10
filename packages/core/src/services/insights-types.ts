import type { JobPriority, JobStatus } from "@fieldops/shared";
import type { Bucket } from "../domain/date-range";

// Repository contracts for 0.2 insights: dashboards (DSH), saved views (JOB-04), search (JOB-11) and
// equipment history (CUS-03). Aggregations run in SQL on indexed columns (DSH-06).

/** A reporting window in local dates of the organization's time zone, plus optional filters. */
export interface ReportFilters {
  from: string;
  to: string;
  timeZone: string;
  technicianId?: string;
  serviceTypeId?: string;
}

export interface KpiTotals {
  /** Jobs created in the period. */
  created: number;
  /** Jobs completed in the period. */
  completed: number;
  /** Completed jobs that met the provisional resolution target of their priority. */
  completedWithinTarget: number;
  /** Completed jobs that needed only one visit (revisit = false). */
  completedFirstVisit: number;
  /** Average minutes from creation to first scheduled, for jobs created in the period. */
  avgResponseMin: number | null;
  /** Average minutes from creation to completion, for jobs completed in the period. */
  avgResolutionMin: number | null;
}

export interface StatusBucketRow {
  bucket: string;
  status: JobStatus;
  count: number;
}

export interface SlaBucketRow {
  bucket: string;
  completed: number;
  withinTarget: number;
}

export interface ServiceTypeCountRow {
  serviceTypeId: string | null;
  name: string | null;
  created: number;
  completed: number;
}

export interface WorkloadRow {
  memberId: string;
  jobs: number;
  scheduledMin: number;
  completed: number;
}

export interface RiskRow {
  id: string;
  number: number;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  customerName: string;
  createdAt: Date;
  scheduledEnd: Date | null;
  assignees: string[];
}

export interface PendingApprovalRow {
  id: string;
  item: string;
  totalMinor: number;
  currency: string;
  requesterName: string | null;
  jobNumber: number;
  jobTitle: string;
  createdAt: Date;
}

export interface OwnStats {
  completed: number;
  workMin: number;
}

export interface DashboardRepo {
  kpis(f: ReportFilters): Promise<KpiTotals>;
  statusSeries(f: ReportFilters, bucket: Bucket): Promise<StatusBucketRow[]>;
  slaTrend(f: ReportFilters, bucket: Bucket): Promise<SlaBucketRow[]>;
  byServiceType(f: ReportFilters): Promise<ServiceTypeCountRow[]>;
  /** Scheduled visits per member in the period (not canceled), with scheduled minutes. */
  workload(f: ReportFilters): Promise<WorkloadRow[]>;
  /** Jobs scheduled on one local date, counted by status. */
  dayStatusCounts(date: string, timeZone: string): Promise<{ status: JobStatus; count: number }[]>;
  /** Open jobs past their provisional response target or past their visit window, most overdue first. */
  atRisk(now: Date, limit: number): Promise<{ total: number; rows: RiskRow[] }>;
  pendingApprovals(limit: number): Promise<{ total: number; rows: PendingApprovalRow[] }>;
  /** A member's completed visits and recorded work minutes in a period. */
  ownStats(memberId: string, from: string, to: string, timeZone: string): Promise<OwnStats>;
}

export interface SavedViewRecord {
  id: string;
  memberId: string;
  ownerName: string;
  resource: string;
  name: string;
  query: string;
  shared: boolean;
  createdAt: Date;
}

export interface SavedViewRepo {
  /** The member's own views plus every shared view of the resource. */
  list(resource: string, memberId: string): Promise<SavedViewRecord[]>;
  get(id: string): Promise<SavedViewRecord | null>;
  create(data: Omit<SavedViewRecord, "id" | "createdAt" | "ownerName">): Promise<SavedViewRecord>;
  remove(id: string): Promise<boolean>;
  countByMember(memberId: string, resource: string): Promise<number>;
}

export interface SearchHits {
  jobs: { id: string; number: number; title: string; status: JobStatus; customerName: string }[];
  customers: { id: string; name: string; type: string; city: string | null }[];
  sites: {
    id: string;
    customerId: string;
    customerName: string;
    label: string;
    line1: string;
    city: string;
  }[];
}

export interface SearchRepo {
  /** Jobs by number or title, customers by name, sites by label or address. */
  search(q: string, opts: { assignedMemberId?: string; limit: number }): Promise<SearchHits>;
}

export interface EquipmentHistoryRow {
  id: string;
  number: number;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  serviceTypeName: string | null;
  scheduledStart: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  technicians: string[];
}
