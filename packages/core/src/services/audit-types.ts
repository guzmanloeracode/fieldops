// Audit log (AUD-01–03). Row changes are logged by a database trigger (ADR 016); this repository records the
// events that aren't row changes and serves the viewer.

export interface AuditEntryRecord {
  id: string;
  createdAt: Date;
  /** Null for system changes (worker, migrations, the seed). */
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  /** The job the entry belongs to (the job itself, or job_id of a job's child row), for links. */
  job: { id: string; number: number } | null;
}

export interface AuditListFilters {
  /** A user id, or "system" for entries without an actor. */
  actor?: string;
  entityType?: string;
  /** The operation part of the action, e.g. "update" or "sign_in". */
  operation?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  /** Keyset position: entries strictly older than this (created_at, id). */
  before?: { createdAt: Date; id: string };
  limit: number;
}

export interface AuditRepo {
  /** Logs an event such as "auth.sign_in" for the organization, actor, IP and user agent of the transaction. */
  record(entry: {
    action: string;
    entityType: string;
    entityId: string | null;
    after?: Record<string, unknown> | null;
  }): Promise<void>;
  /** Newest first. Returns at most `limit` rows. */
  list(filters: AuditListFilters): Promise<AuditEntryRecord[]>;
  /** People who appear in the log, for the actor filter. */
  actors(): Promise<{ userId: string; name: string }[]>;
}
