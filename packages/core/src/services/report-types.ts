import type { AiStatus, Locale, ReportStatus } from "@fieldops/shared";
import type { AiProvider, IntakeModelResult, IntakePhoto } from "./ai-types";
import type {
  AttachmentRecord,
  ContactRecord,
  CustomerRecord,
  JobView,
  OrganizationRecord,
  SiteRecord,
} from "./types";

// Service reports (AI-03, FIN-04). One report per job, created when the job is completed. The writer model sits
// behind the `ReportModel` port like intake: Claude, the deterministic fixture and "unavailable" live in
// packages/ai.

export interface ServiceReportRecord {
  id: string;
  jobId: string;
  status: ReportStatus;
  /** The customer's language: the report's text, its PDF and the email (SET-05). */
  locale: Locale;
  workPerformed: string | null;
  findings: string | null;
  recommendations: string | null;
  /** YYYY-MM-DD */
  nextServiceDate: string | null;
  /** pending → drafting (claimed) → drafted | failed; skipped when AI is off or used up. */
  aiStatus: AiStatus | null;
  aiInteractionId: string | null;
  /** The current text came from the model. */
  aiDrafted: boolean;
  /** The last person who changed the text; null while it is as drafted. */
  editedBy: string | null;
  sentAt: Date | null;
  sentTo: string | null;
  sentBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewServiceReport = Omit<ServiceReportRecord, "id" | "version" | "createdAt" | "updatedAt">;
export type ServiceReportPatch = Partial<
  Omit<ServiceReportRecord, "id" | "jobId" | "version" | "createdAt" | "updatedAt">
>;

export interface ReportRepo {
  get(id: string): Promise<ServiceReportRecord | null>;
  getByJob(jobId: string): Promise<ServiceReportRecord | null>;
  /** Creates the job's report. There is one per job: when it already exists, returns null. */
  create(data: NewServiceReport): Promise<ServiceReportRecord | null>;
  /** Applies the patch and bumps the version. With `expectedVersion`, returns null on a version mismatch. */
  update(
    id: string,
    patch: ServiceReportPatch,
    expectedVersion?: number,
  ): Promise<ServiceReportRecord | null>;
  /**
   * Changes the AI status without counting as an edit (no version bump). With `from`, only when the status is
   * still that one; returns whether it changed.
   */
  setAiStatus(id: string, status: AiStatus, from?: AiStatus): Promise<boolean>;
}

// ------------------------------------------------------------------ the model port

/** One checklist answer, already formatted in the report's language. */
export interface ReportChecklistLine {
  label: string;
  /** "13.5 °C", a text answer, or null for a checkbox or photo. */
  value: string | null;
  done: boolean;
}

export interface ReportModelInput {
  /** Language to write in. */
  locale: Locale;
  organizationName: string;
  job: {
    number: string;
    title: string;
    /** The request as the customer or the dispatcher described it. */
    description: string | null;
    serviceType: string | null;
    equipment: string | null;
    /** YYYY-MM-DD in the organization's time zone. */
    completedOn: string;
  };
  checklist: ReportChecklistLine[];
  /** Notes marked for the customer only; internal notes never reach the model. */
  notes: string[];
  parts: { description: string; quantity: number }[];
  /** Up to MAX_REPORT_AI_PHOTOS small before and after photos. */
  photos: (IntakePhoto & { tag: "before" | "after" | null })[];
}

/** Same shape as an intake result: the model call never throws. */
export type ReportModelResult = IntakeModelResult;

export interface ReportModel {
  readonly provider: AiProvider;
  readonly model: string;
  draft(input: ReportModelInput): Promise<ReportModelResult>;
}

/** The report text a draft fills in. */
export interface ReportDraft {
  workPerformed: string;
  findings: string | null;
  recommendations: string | null;
  nextServiceDate: string | null;
}

// ------------------------------------------------------------------ sending and the PDF

/** The "Job completed" email to the customer with the report link (§8.7). Written to the outbox by the caller. */
export interface ReportEmail {
  to: string;
  locale: Locale;
  contactName: string | null;
  organizationName: string;
  jobNumber: string;
  jobTitle: string;
  /** YYYY-MM-DD */
  completedOn: string;
  url: string;
  expiresAt: Date;
}

export interface ReportSendDeps {
  /** Writes the email in the caller's transaction, so it exists only if the send commits. */
  sendEmail(email: ReportEmail): Promise<void>;
  /** The signed download link for a report, valid until `expiresAt`. */
  linkFor(report: { organizationId: string; reportId: string }, expiresAt: Date): string;
}

/** Everything the PDF needs, read in one transaction; the caller loads the images and renders it. */
export interface ReportDocumentData {
  report: ServiceReportRecord;
  organization: OrganizationRecord;
  job: JobView;
  customer: CustomerRecord;
  site: SiteRecord;
  primaryContact: ContactRecord | null;
  /** YYYY-MM-DD in the organization's time zone. */
  completedOn: string;
  technicians: string[];
  checklist: ReportChecklistLine[];
  parts: { description: string; quantity: number }[];
  /** Ready photos, before ones first, then after ones, then the rest. */
  photos: AttachmentRecord[];
  signature: AttachmentRecord | null;
}
