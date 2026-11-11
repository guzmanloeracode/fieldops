import type {
  ApiKeyScope,
  WebhookDeliveryRepr,
  WebhookAttemptRepr,
  WebhookEndpointCreateInput,
  WebhookEndpointRepr,
  WebhookEndpointUpdateInput,
} from "@fieldops/shared";

// Release 0.5 (Platform). The event relay port: outgoing webhooks are delivered by Relay (PLT-03, §11.4), which is
// the source of truth for endpoints, their secrets and the delivery log; FieldOps keeps none of that. The tenant is
// the organization ID. The implementation is the Relay HTTP client in packages/relay, which also has a small fake
// Relay server for development, unit tests and the E2E suite. Without RELAY_URL and RELAY_API_KEY there is no relay:
// webhooks say they aren't configured and no organization can turn them on.
//
// Every method may call the network: never call one inside a database transaction.

/** An integration event from outbox_event, posted with its row id as the Idempotency-Key. */
export interface OutgoingEvent {
  id: string;
  organizationId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface CreatedEndpoint {
  endpoint: WebhookEndpointRepr;
  /** `whsec_…`, shown once when the endpoint is created and when its secret is rotated. */
  secret: string;
}

export interface DeliveryPage {
  items: WebhookDeliveryRepr[];
  next_cursor: string | null;
}

export interface DeliveryFilters {
  endpointId?: string;
  status?: WebhookDeliveryRepr["status"];
  cursor?: string;
  limit?: number;
}

/** Failures the caller can show: Relay unreachable, or Relay refusing the request (e.g. an SSRF-blocked URL). */
export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

export interface EventRelay {
  /** Creates the organization's tenant if it doesn't exist yet. Idempotent. */
  ensureTenant(organizationId: string, name: string): Promise<void>;
  /** Posts one event; returns Relay's event id (`evt_…`). Repeating an id replays the original answer. */
  publish(event: OutgoingEvent): Promise<string>;

  listEndpoints(organizationId: string): Promise<WebhookEndpointRepr[]>;
  getEndpoint(organizationId: string, endpointId: string): Promise<WebhookEndpointRepr | null>;
  createEndpoint(organizationId: string, input: WebhookEndpointCreateInput): Promise<CreatedEndpoint>;
  updateEndpoint(
    organizationId: string,
    endpointId: string,
    input: WebhookEndpointUpdateInput,
  ): Promise<WebhookEndpointRepr | null>;
  deleteEndpoint(organizationId: string, endpointId: string): Promise<boolean>;
  rotateSecret(organizationId: string, endpointId: string): Promise<string>;
  /** Sends a `webhook.test` event to this endpoint only. Returns the event id. */
  sendTest(organizationId: string, endpointId: string): Promise<string>;

  listDeliveries(organizationId: string, filters: DeliveryFilters): Promise<DeliveryPage>;
  getDelivery(
    organizationId: string,
    deliveryId: string,
  ): Promise<{ delivery: WebhookDeliveryRepr; attempts: WebhookAttemptRepr[] } | null>;
  /** Delivers the delivery's event to its endpoint again, as a new delivery. */
  redeliver(organizationId: string, deliveryId: string): Promise<WebhookDeliveryRepr>;
  /** Removes every endpoint of the organization (demo reset). */
  deleteAllEndpoints(organizationId: string): Promise<number>;
}

/** An authenticated API key (PLT-02): who it acts as and what it may do. */
export interface ApiKeyPrincipal {
  keyId: string;
  organizationId: string;
  memberId: string;
  userId: string;
  scopes: ApiKeyScope[];
}
