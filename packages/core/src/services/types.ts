import type {
  Address,
  AttachmentKind,
  AttachmentTag,
  ChecklistTemplateItem,
  Currency,
  CustomerListQuery,
  CustomerType,
  HoldReason,
  JobEventType,
  JobListQuery,
  JobPriority,
  JobSource,
  JobStatus,
  NoteVisibility,
  Role,
  SlaState,
  AiStatus,
} from "@fieldops/shared";
import type { Actor } from "../domain/permissions";
import type { ExpenseRepo } from "./expense-types";
import type { DashboardRepo, EquipmentHistoryRow, SavedViewRepo, SearchRepo } from "./insights-types";
import type { ChecklistRepo, TimeEntryRepo } from "./fieldwork-types";
import type { AvailabilityRepo, ScheduleRepo } from "./dispatch-types";
import type { SlaRepo } from "./sla-types";
import type { NotificationMailer, NotificationRepo } from "./notification-types";
import type { AuditRepo } from "./audit-types";
import type { PortalRepo } from "./portal-types";
import type { AiRepo } from "./ai-types";

// Records are what repositories return. They use camelCase and real Date objects; the API layer maps
// them to the snake_case representations in @fieldops/shared.

export interface CustomerRecord {
  id: string;
  type: CustomerType;
  name: string;
  billingAddress: Address | null;
  tags: string[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactRecord {
  id: string;
  customerId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface CustomerListRow extends CustomerRecord {
  primaryContact: Pick<ContactRecord, "name" | "email" | "phone"> | null;
  siteCount: number;
  openJobCount: number;
  lastJobAt: Date | null;
}

export interface SiteRecord {
  id: string;
  customerId: string;
  label: string;
  address: Address;
  latitude: number | null;
  longitude: number | null;
  accessNotes: string | null;
  onsiteContactName: string | null;
  onsiteContactPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EquipmentRecord {
  id: string;
  siteId: string;
  type: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  installDate: string | null;
  warrantyEnd: string | null;
  /** Free-text notes (optional so older fixtures stay valid). */
  notes?: string | null;
}

export interface ServiceTypeRecord {
  id: string;
  name: string;
  description: string | null;
  defaultDurationMin: number;
  defaultPriceMinor: number;
  currency: Currency;
  color: string | null;
  active: boolean;
  /** Skills a technician needs for this work (SCH-03). */
  requiredSkills: string[];
  /** Copied into each new job's checklist (JOB-08). */
  checklistTemplate: ChecklistTemplateItem[];
}

export interface JobRecord {
  id: string;
  number: number;
  customerId: string;
  siteId: string;
  equipmentId: string | null;
  serviceTypeId: string | null;
  title: string;
  description: string | null;
  priority: JobPriority;
  status: JobStatus;
  source: JobSource;
  holdReason: HoldReason | null;
  preferredStart: Date | null;
  preferredEnd: Date | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  estimatedDurationMin: number | null;
  /** First time the job was scheduled with a technician (response time). */
  firstScheduledAt: Date | null;
  /** Needed another visit: rescheduled from hold or reopened. */
  revisit: boolean;
  aiDrafted: boolean;
  needsReview: boolean;
  /** AI drafting of a portal request (AI-01); null for other jobs. */
  aiStatus: AiStatus | null;
  /** SLA (SLA-01, SLA-02): the policy used, the deadlines, when each window is 75% used, and the states. */
  slaPolicyId: string | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  responseAtRiskAt: Date | null;
  resolutionAtRiskAt: Date | null;
  slaResponseState: SlaState | null;
  slaResolutionState: SlaState | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface AssigneeRef {
  memberId: string;
  userId: string;
  name: string;
  isLead: boolean;
}

export interface JobView extends JobRecord {
  customer: { id: string; name: string };
  site: {
    id: string;
    label: string;
    address: Address;
    latitude: number | null;
    longitude: number | null;
    accessNotes: string | null;
  };
  serviceType: { id: string; name: string } | null;
  assignees: AssigneeRef[];
}

export interface JobEventRecord {
  id: string;
  jobId: string;
  type: JobEventType;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  actor: { id: string; name: string } | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface NoteRecord {
  id: string;
  jobId: string;
  body: string;
  visibility: NoteVisibility;
  author: { id: string; name: string } | null;
  createdAt: Date;
}

export interface AttachmentRecord {
  id: string;
  jobId: string;
  kind: AttachmentKind;
  storageKey: string;
  thumbKey: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  tag: AttachmentTag | null;
  caption: string | null;
  status: "pending" | "ready";
  uploadedBy: string | null;
  createdAt: Date;
}

export interface WorkingHours {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  open: string;
  close: string;
}

export interface MemberRecord {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  isDemo: boolean;
  skills: string[];
  /** Null follows the organization's business hours. */
  workingHours: WorkingHours[] | null;
  phone: string | null;
  createdAt: Date;
}

/** Organization settings stored as JSON, with defaults filled in by the repository. */
export interface OrganizationSettings {
  approval: { autoApproveBelowMinor: number; dispatcherLimitMinor: number };
  /** Completing a job needs a customer signature (JOB-10). */
  requireSignature: boolean;
  /** AI features on or off and the monthly number of AI calls allowed (SET-04). */
  ai: { enabled: boolean; monthlyQuota: number };
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string;
  currency: Currency;
  country: string;
  brandColor: string | null;
  address: Address | null;
  businessHours: WorkingHours[];
  taxRates: { name: string; rate_bps: number; default: boolean }[];
  settings: OrganizationSettings;
  isDemo: boolean;
}

export interface Page<T> {
  rows: T[];
  /** Keyset cursor for the next page (API). */
  nextCursor: string | null;
  /** Total rows for offset pagination (UI). Only computed when a page number was requested. */
  total: number | null;
}

export interface JobListFilters extends JobListQuery {
  /** Restricts results to jobs assigned to this member (technicians). */
  assignedMemberId?: string;
}

export interface CustomerListFilters extends CustomerListQuery {
  assignedMemberId?: string;
}

// ------------------------------------------------------------------ repositories

export interface CustomerRepo {
  list(filters: CustomerListFilters): Promise<Page<CustomerListRow>>;
  get(id: string): Promise<CustomerRecord | null>;
  create(data: Omit<CustomerRecord, "id" | "createdAt" | "updatedAt">): Promise<CustomerRecord>;
  update(
    id: string,
    patch: Partial<Omit<CustomerRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<CustomerRecord | null>;
  softDelete(id: string): Promise<boolean>;
  contacts(customerId: string): Promise<ContactRecord[]>;
  addContact(
    customerId: string,
    data: Omit<ContactRecord, "id" | "customerId"> & { emailNorm: string | null; phoneNorm: string | null },
  ): Promise<ContactRecord>;
  findDuplicates(match: {
    emails: string[];
    phones: string[];
    excludeCustomerId?: string;
  }): Promise<{ id: string; name: string; matchedOn: "email" | "phone" }[]>;
  /** True when the member is assigned to at least one job for this customer. */
  isLinkedToMember(customerId: string, memberId: string): Promise<boolean>;
  stats(
    customerId: string,
  ): Promise<{ jobCount: number; openJobCount: number; completedJobCount: number; lastJobAt: Date | null }>;
}

export interface SiteRepo {
  listByCustomer(customerId: string): Promise<SiteRecord[]>;
  get(id: string): Promise<SiteRecord | null>;
  create(
    customerId: string,
    data: Omit<SiteRecord, "id" | "customerId" | "createdAt" | "updatedAt">,
  ): Promise<SiteRecord>;
  update(
    id: string,
    patch: Partial<Omit<SiteRecord, "id" | "customerId" | "createdAt" | "updatedAt">>,
  ): Promise<SiteRecord | null>;
  isLinkedToMember(siteId: string, memberId: string): Promise<boolean>;
}

export interface EquipmentRepo {
  get(id: string): Promise<EquipmentRecord | null>;
  listBySite(siteId: string): Promise<EquipmentRecord[]>;
  create(siteId: string, data: Omit<EquipmentRecord, "id" | "siteId">): Promise<EquipmentRecord>;
  update(id: string, patch: Partial<Omit<EquipmentRecord, "id" | "siteId">>): Promise<EquipmentRecord | null>;
  softDelete(id: string): Promise<boolean>;
  /** Jobs that serviced this unit, newest first (CUS-03). */
  history(id: string, opts: { assignedMemberId?: string; limit: number }): Promise<EquipmentHistoryRow[]>;
}

export interface ServiceTypeRepo {
  list(opts?: { includeInactive?: boolean }): Promise<ServiceTypeRecord[]>;
  get(id: string): Promise<ServiceTypeRecord | null>;
  create(data: Omit<ServiceTypeRecord, "id">): Promise<ServiceTypeRecord>;
  update(id: string, patch: Partial<Omit<ServiceTypeRecord, "id">>): Promise<ServiceTypeRecord | null>;
}

/** SLA columns: set when a job is created or its priority changes, then kept current (SLA-02). */
export type JobSlaField =
  | "slaPolicyId"
  | "responseDueAt"
  | "resolutionDueAt"
  | "responseAtRiskAt"
  | "resolutionAtRiskAt"
  | "slaResponseState"
  | "slaResolutionState";

export interface JobRepo {
  list(filters: JobListFilters): Promise<Page<JobView>>;
  get(id: string): Promise<JobView | null>;
  getByNumber(number: number): Promise<JobView | null>;
  nextNumber(): Promise<number>;
  create(
    data: Omit<
      JobRecord,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "version"
      | "completedAt"
      | "canceledAt"
      | "scheduledStart"
      | "scheduledEnd"
      | "status"
      | "holdReason"
      | "firstScheduledAt"
      | "revisit"
      | JobSlaField
      | "aiStatus"
    > &
      Partial<Pick<JobRecord, JobSlaField | "aiStatus">>,
  ): Promise<JobRecord>;
  /** Applies the patch and bumps the version. With `expectedVersion`, returns null on a version mismatch. */
  update(
    id: string,
    patch: Partial<Omit<JobRecord, "id" | "number" | "createdAt" | "updatedAt" | "version">>,
    expectedVersion?: number,
  ): Promise<JobRecord | null>;
  softDelete(id: string): Promise<boolean>;
  setAssignments(jobId: string, assignments: { memberId: string; isLead: boolean }[]): Promise<void>;
  addEvent(
    event: Omit<JobEventRecord, "id" | "createdAt" | "actor"> & { actorUserId: string | null },
  ): Promise<void>;
  events(jobId: string): Promise<JobEventRecord[]>;
  /** Jobs assigned to the member that overlap the window, excluding one job. */
  overlapping(
    memberId: string,
    start: Date,
    end: Date,
    excludeJobId: string,
  ): Promise<{ id: string; number: number }[]>;
  missingRequiredChecklistItems(jobId: string): Promise<string[]>;
}

export interface NoteRepo {
  list(jobId: string, opts?: { visibility?: NoteVisibility }): Promise<NoteRecord[]>;
  create(
    jobId: string,
    data: { body: string; visibility: NoteVisibility; authorUserId: string },
  ): Promise<NoteRecord>;
}

export interface AttachmentRepo {
  list(jobId: string): Promise<AttachmentRecord[]>;
  get(id: string): Promise<AttachmentRecord | null>;
  create(data: Omit<AttachmentRecord, "id" | "createdAt">): Promise<AttachmentRecord>;
  markReady(id: string): Promise<AttachmentRecord | null>;
  remove(id: string): Promise<boolean>;
}

export interface MemberRepo {
  list(): Promise<MemberRecord[]>;
  get(memberId: string): Promise<MemberRecord | null>;
  updateRole(memberId: string, role: Role): Promise<void>;
  remove(memberId: string): Promise<void>;
  countByRole(role: Role): Promise<number>;
}

export interface OrganizationRepo {
  get(): Promise<OrganizationRecord>;
  update(patch: Partial<Omit<OrganizationRecord, "id" | "slug" | "isDemo">>): Promise<OrganizationRecord>;
}

/** All repositories, bound to one organization and one database transaction. */
export interface Store {
  organizationId: string;
  customers: CustomerRepo;
  sites: SiteRepo;
  equipment: EquipmentRepo;
  serviceTypes: ServiceTypeRepo;
  jobs: JobRepo;
  notes: NoteRepo;
  attachments: AttachmentRepo;
  members: MemberRepo;
  organization: OrganizationRepo;
  expenses: ExpenseRepo;

  // 0.2 insights (DSH, JOB-04, JOB-11)
  dashboard: DashboardRepo;
  savedViews: SavedViewRepo;
  search: SearchRepo;
  checklist: ChecklistRepo;
  timeEntries: TimeEntryRepo;
  // 0.2 dispatch (SCH)
  availability: AvailabilityRepo;
  schedule: ScheduleRepo;
  // 0.3 automate
  sla: SlaRepo;
  notifications: NotificationRepo;
  audit: AuditRepo;
  portal: PortalRepo;
  ai: AiRepo;
}

export interface FileStorage {
  /** Presigned PUT. With `sizeBytes`, the upload must be exactly that size. */
  presignPut(
    key: string,
    contentType: string,
    sizeBytes?: number,
  ): Promise<{ url: string; headers: Record<string, string>; expiresIn: number }>;
  presignGet(key: string, opts?: { downloadName?: string }): Promise<string>;
  exists(key: string): Promise<boolean>;
  remove(keys: string[]): Promise<void>;
}

export interface ServiceContext {
  actor: Actor;
  store: Store;
  now: Date;
  /** Public demo safeguards (DEM-05). */
  demo: boolean;
  files?: FileStorage;
  /** Sends notification emails through the outbox, in the same transaction (NOT-02). */
  mailer?: NotificationMailer;
}
