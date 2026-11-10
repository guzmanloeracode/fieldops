// Audit log (AUD-01–03). Row changes are logged by a database trigger (ADR 016); this repository records the
// events that aren't row changes and serves the viewer. The audit slice extends it.

export interface AuditRepo {
  /** Logs an event such as "auth.sign_in" for the organization, actor, IP and user agent of the transaction. */
  record(entry: {
    action: string;
    entityType: string;
    entityId: string | null;
    after?: Record<string, unknown> | null;
  }): Promise<void>;
}
