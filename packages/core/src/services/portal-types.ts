import type { JobEventType, JobStatus } from "@fieldops/shared";
import type { NotificationMailer } from "./notification-types";
import type { FileStorage, Store } from "./types";

// Customer portal (POR-01–03). A portal customer is a contact of one customer; every read and write is scoped
// to that customer inside the organization's tenant transaction.

/** The signed-in portal customer, always built on the server from the portal session. */
export interface PortalActor {
  organizationId: string;
  customerId: string;
  customerName: string;
  contactId: string;
  contactName: string;
}

export interface PortalContext {
  portal: PortalActor;
  store: Store;
  now: Date;
  /** Public demo safeguards (DEM-05). */
  demo: boolean;
  files?: FileStorage;
  mailer?: NotificationMailer;
}

export interface PortalContactRecord {
  id: string;
  customerId: string;
  customerName: string;
  name: string;
  email: string;
}

export interface PortalSessionRecord {
  id: string;
  contactId: string;
  contactName: string;
  customerId: string;
  customerName: string;
  expiresAt: Date;
  lastSeenAt: Date | null;
}

/** What a customer may see of a job: no prices, internal notes, other customers or technicians' full names. */
export interface PortalJobRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: JobStatus;
  source: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  site: { label: string; line1: string; city: string };
  /** Full name; the service reduces it to the first name. */
  leadTechnicianName: string | null;
}

export interface PortalJobEvent {
  type: JobEventType;
  toStatus: JobStatus | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** A photo uploaded for a request that hasn't been sent yet (POR-02). */
export interface PortalPhoto {
  storageKey: string;
  thumbKey: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PortalRepo {
  /** A contact of a live customer with this normalized email (the first one, if several share it). */
  findContactByEmail(emailNorm: string): Promise<PortalContactRecord | null>;
  getContact(contactId: string): Promise<PortalContactRecord | null>;
  createToken(input: { contactId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  /** Marks an unused, unexpired link as used and returns its contact; null otherwise (single use). */
  consumeToken(tokenHash: string, now: Date): Promise<{ contactId: string } | null>;
  createSession(input: {
    contactId: string;
    customerId: string;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void>;
  /** An unexpired session whose contact and customer still exist. */
  findSession(tokenHash: string, now: Date): Promise<PortalSessionRecord | null>;
  touchSession(id: string, now: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** The customer's jobs, open ones first, then the most recent. */
  listJobs(customerId: string, limit: number): Promise<PortalJobRow[]>;
  getJobByNumber(customerId: string, number: number): Promise<PortalJobRow | null>;
  /** Created, assignment and status events only, oldest first. */
  jobEvents(jobId: string): Promise<PortalJobEvent[]>;
  /** Notes written for the customer (visibility "customer"), oldest first. */
  customerNotes(jobId: string): Promise<{ body: string; createdAt: Date }[]>;
}
