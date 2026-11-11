// Outgoing webhooks (PLT-03): the little FieldOps keeps itself. Endpoints, secrets and the delivery log live in
// Relay (ADR 022); the database holds whether the organization has webhooks on and the outbox of its events.

export interface WebhookState {
  /** When webhooks were turned on; null while they are off. */
  enabledAt: Date | null;
  /** The organization's name, used as the Relay tenant's name. */
  name: string;
}

export interface WebhookRepo {
  state(): Promise<WebhookState>;
  setEnabled(at: Date | null): Promise<void>;
  /** Types of the organization's outbox events Relay accepted, by Relay event id (`evt_…`). */
  eventTypes(relayEventIds: string[]): Promise<Record<string, string>>;
}
